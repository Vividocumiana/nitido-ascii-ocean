/**
 * "Your site, alive": one creature whose body is built from a website.
 *
 *   - the spine is the homepage's sections, in order (hero = head, footer = tail)
 *   - each extra page is a fin
 *   - the skin is drawn in thin "linear" ASCII: oriented line glyphs on the
 *     contour, the section's own headline letters faintly inside
 *   - the school of fish around it is the last 24h of visitors
 *
 * Motion comes from World (the same spine + boids sim as the ocean); this
 * file only maps a site onto the body and draws it.
 */
import { clamp, smoothstep } from "./math";
import { hexRgb } from "./config";
import { SHARK_NODES, World } from "./world";

export interface SiteSection {
  type: string;
  headline: string;
}

export interface SiteData {
  name: string;
  brand: string;
  sections: SiteSection[];
  pages: string[];
  visits24h: number;
}

export interface SceneOptions {
  style: "linear" | "soft";
  /** 0..1, how far the brand palette stands out from the background. */
  intensity: number;
  cell: number;
  background: string;
  visitsPerFish: number;
}

type RGB = [number, number, number];

const INK: RGB = [38, 38, 42];
const STEP = 1 / 60;

const mix = (a: RGB, b: RGB, k: number): RGB => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
const css = ([r, g, b]: RGB) => `rgb(${Math.round(r)},${Math.round(g)},${Math.round(b)})`;

function inTriangle(px: number, py: number, ax: number, ay: number, bx: number, by: number, cx: number, cy: number) {
  const d1 = (px - bx) * (ay - by) - (ax - bx) * (py - by);
  const d2 = (px - cx) * (by - cy) - (bx - cx) * (py - cy);
  const d3 = (px - ax) * (cy - ay) - (cx - ax) * (py - ay);
  return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
}

/** Distance from p to segment ab (2D). */
function segDist(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax;
  const dy = by - ay;
  const t = clamp(((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1), 0, 1);
  return Math.hypot(px - ax - dx * t, py - ay - dy * t);
}

/** Line glyph for a screen direction, measured in cell units so diagonals match the cell aspect. */
function lineGlyph(dx: number, dy: number, cw: number, ch: number) {
  let a = Math.atan2(dy / ch, dx / cw);
  if (a < 0) a += Math.PI;
  const e = Math.PI / 8;
  if (a < e || a > 7 * e) return "─";
  if (a < 3 * e) return "╲";
  if (a < 5 * e) return "│";
  return "╱";
}

export class SiteScene {
  readonly world: World;
  private ctx: CanvasRenderingContext2D;
  private W = 0;
  private H = 0;
  private dpr = 1;
  private cw = 8;
  private ch = 12;
  private raf = 0;
  private last = 0;
  private acc = 0;
  private targetLength = 0;
  private bounds: number[] = [];
  private spine = new Float32Array(SHARK_NODES * 2);
  private arc = new Float32Array(SHARK_NODES);
  private occupied = new Uint8Array(0);
  private ro: ResizeObserver;

  constructor(
    private canvas: HTMLCanvasElement,
    private site: SiteData,
    public opts: SceneOptions,
  ) {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("2D canvas unavailable");
    this.ctx = ctx;
    this.world = new World([{ kind: "classic", size: 1 }], this.fishCount());
    this.setSite(site);
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(canvas);
    canvas.addEventListener("pointermove", (e) => {
      const r = canvas.getBoundingClientRect();
      Object.assign(this.world.pointer, { x: e.clientX - r.left, y: e.clientY - r.top, active: true });
    });
    canvas.addEventListener("pointerleave", () => (this.world.pointer.active = false));
    this.resize();
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
  }

  private fishCount() {
    return clamp(Math.round(this.site.visits24h / this.opts.visitsPerFish), 3, 260);
  }

  /** Body length grows with the number of sections. */
  private lengthFor(site: SiteData) {
    const base = clamp(Math.min(this.W || 400, this.H || 240) * 0.44, 170, 430);
    return base * (0.8 + 0.2 * site.sections.length);
  }

  /** Swap the site the body is built from; the length eases to the new size. */
  setSite(site: SiteData) {
    this.site = site;
    // Hero gets a bigger head, footer a short tail.
    const weights = site.sections.map((s, i) => (i === 0 ? 1.5 : i === site.sections.length - 1 ? 0.7 : 1));
    const total = weights.reduce((a, b) => a + b, 0);
    let acc = 0;
    this.bounds = weights.map((w) => (acc += w / total));
    this.targetLength = this.lengthFor(site);
  }

  /** Re-populate the school (visitor count changed). */
  reseed() {
    this.world.reseed([{ kind: "classic", size: 1 }], this.fishCount());
    const sh = this.world.sharks[0];
    if (sh) this.scaleShark(this.targetLength);
  }

  private scaleShark(L: number) {
    const sh = this.world.sharks[0];
    if (sh) sh.length = L;
  }

  private resize() {
    const r = this.canvas.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return;
    this.dpr = Math.min(devicePixelRatio || 1, 2);
    this.W = r.width;
    this.H = r.height;
    this.cw = this.opts.cell;
    this.ch = Math.round(this.opts.cell * 1.45);
    this.canvas.width = Math.round(r.width * this.dpr);
    this.canvas.height = Math.round(r.height * this.dpr);
    const first = this.world.width === 0;
    this.world.resize(r.width, r.height, this.cw, this.ch);
    this.targetLength = this.lengthFor(this.site);
    if (first) this.scaleShark(this.targetLength);
    this.occupied = new Uint8Array(Math.ceil(r.width / this.cw) * Math.ceil(r.height / this.ch));
  }

  setCell(cell: number) {
    this.opts.cell = cell;
    this.resize();
  }

  private frame = (now: number) => {
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    this.acc += dt;
    let n = 0;
    while (this.acc >= STEP && n < 4) {
      this.world.step(STEP);
      this.acc -= STEP;
      n++;
    }
    if (n === 4) this.acc = 0;
    const sh = this.world.sharks[0];
    if (sh) sh.length += (this.targetLength - sh.length) * Math.min(1, dt * 1.6);
    this.world.events.length = 0;
    this.render();
    this.raf = requestAnimationFrame(this.frame);
  };

  /** Half-width of the body at s (0 head → 1 tail), with a waist at each section seam. */
  private halfWidth(s: number, L: number) {
    let w: number;
    if (s < 0.09) w = 0.1 * Math.pow(Math.sin(((s / 0.09) * Math.PI) / 2), 0.6);
    else if (s < 0.28) w = 0.1 + 0.012 * smoothstep(0.09, 0.28, s);
    else w = 0.014 + 0.098 * Math.pow(1 - (s - 0.28) / 0.72, 1.15);
    for (let i = 0; i < this.bounds.length - 1; i++) {
      const d = (s - this.bounds[i]) / 0.013;
      w *= 1 - 0.2 * Math.exp(-d * d);
    }
    return w * L;
  }

  private sectionAt(s: number) {
    for (let i = 0; i < this.bounds.length; i++) if (s <= this.bounds[i]) return i;
    return this.bounds.length - 1;
  }

  private render() {
    const { ctx, W, H, dpr, cw, ch, spine, arc, occupied } = this;
    const sh = this.world.sharks[0];
    const bg = hexRgb(this.opts.background);
    const brand = hexRgb(this.site.brand);
    const k = this.opts.intensity;
    const cols = Math.ceil(W / cw);
    const rows = Math.ceil(H / ch);
    occupied.fill(0);

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = this.opts.background;
    ctx.fillRect(0, 0, W, H);
    // Faint cell grid.
    ctx.strokeStyle = `rgba(0,0,0,0.035)`;
    ctx.lineWidth = 1 / dpr;
    ctx.beginPath();
    for (let c = 0; c <= cols; c++) {
      ctx.moveTo(c * cw, 0);
      ctx.lineTo(c * cw, H);
    }
    for (let r = 0; r <= rows; r++) {
      ctx.moveTo(0, r * ch);
      ctx.lineTo(W, r * ch);
    }
    ctx.stroke();

    ctx.font = `500 ${Math.round(ch * 0.8)}px "Geist Mono", ui-monospace, Menlo, monospace`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    // Palette: brand → a few tones toward ink, each pulled back toward the background.
    const nSec = this.site.sections.length;
    const tones = this.site.sections.map((_, i) => mix(brand, INK, [0.05, 0.3, 0.15, 0.42][i % 4]));
    const edgeCol = tones.map((t) => css(mix(bg, t, 0.45 + 0.45 * k)));
    const seamCol = tones.map((t) => css(mix(bg, t, 0.6 + 0.4 * k)));
    const textCol = tones.map((t) => css(mix(bg, t, 0.18 + 0.25 * k)));
    const fillCol = tones.map((t) => css(mix(bg, t, 0.05 + 0.1 * k)));
    const finCol = css(mix(bg, mix(brand, INK, 0.2), 0.35 + 0.4 * k));
    const finText = css(mix(bg, INK, 0.25));
    const eyeCol = css(mix(bg, INK, 0.85));
    const fishCol = css(mix(bg, mix(INK, brand, 0.18), 0.42));

    if (sh) {
      const L = sh.length;
      const N = SHARK_NODES;
      const nd = sh.nodes;
      const swim = clamp(sh.speed / 60, 0.4, 1.4);
      // Travelling body wave (same as the ocean renderer).
      for (let i = 0; i < N; i++) {
        const s = i / (N - 1);
        const a = Math.max(0, i - 1);
        const b = Math.min(N - 1, i + 1);
        let tx = nd[a * 2] - nd[b * 2];
        let ty = nd[a * 2 + 1] - nd[b * 2 + 1];
        const tl = Math.hypot(tx, ty) || 1;
        tx /= tl;
        ty /= tl;
        const off = L * 0.045 * (0.1 + 0.9 * Math.pow(s, 1.8)) * swim * Math.sin(sh.phase - s * 5.2);
        spine[i * 2] = nd[i * 2] - ty * off;
        spine[i * 2 + 1] = nd[i * 2 + 1] + tx * off;
      }
      arc[0] = 0;
      for (let i = 1; i < N; i++) arc[i] = arc[i - 1] + Math.hypot(spine[i * 2] - spine[i * 2 - 2], spine[i * 2 + 1] - spine[i * 2 - 1]);
      const total = arc[N - 1] || 1;

      // Fins: one pair per two pages, spread along the body, front pair biggest.
      const pairs = Math.ceil(this.site.pages.length / 2);
      const fins = Array.from({ length: pairs }, (_, p) => {
        const pos = 0.2 + (0.52 * (p + 0.5)) / Math.max(1, pairs);
        const reach = L * (0.15 - 0.06 * (p / Math.max(1, pairs))) * (1 + 0.08 * Math.sin(sh.phase * 0.5 + p));
        return { u0: L * (pos - 0.04), u1: L * (pos + 0.02), u2: L * (pos + 0.075), reach };
      });

      // Two eyes, one cell each, just behind the snout on either side.
      const eyeCells = new Set<number>();
      {
        const k = 1;
        const hx = spine[k * 2], hy = spine[k * 2 + 1];
        const tx = spine[0] - spine[4], ty = spine[1] - spine[5];
        const tl = Math.hypot(tx, ty) || 1;
        const off = this.halfWidth(k / (SHARK_NODES - 1), L) * 0.42;
        for (const sgn of [1, -1]) {
          const ex = hx + (-ty / tl) * off * sgn;
          const ey = hy + (tx / tl) * off * sgn;
          eyeCells.add(Math.floor(ey / ch) * cols + Math.floor(ex / cw));
        }
      }

      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (let i = 0; i < N; i++) {
        minX = Math.min(minX, spine[i * 2]);
        maxX = Math.max(maxX, spine[i * 2]);
        minY = Math.min(minY, spine[i * 2 + 1]);
        maxY = Math.max(maxY, spine[i * 2 + 1]);
      }
      const pad = L * 0.2;
      const c0 = Math.max(0, Math.floor((minX - pad) / cw));
      const c1 = Math.min(cols - 1, Math.floor((maxX + pad) / cw));
      const r0 = Math.max(0, Math.floor((minY - pad) / ch));
      const r1 = Math.min(rows - 1, Math.floor((maxY + pad) / ch));

      for (let r = r0; r <= r1; r++) {
        for (let c = c0; c <= c1; c++) {
          const px = c * cw + cw / 2;
          const py = r * ch + ch / 2;
          // Nearest point on the spine → body coords (u along, a across).
          let best = Infinity, bu = 0, side = 1, tx = 1, ty = 0;
          for (let i = 0; i < N - 1; i++) {
            const ax = spine[i * 2], ay = spine[i * 2 + 1];
            const sx = spine[i * 2 + 2] - ax, sy = spine[i * 2 + 3] - ay;
            const l2 = sx * sx + sy * sy || 1;
            const t = clamp(((px - ax) * sx + (py - ay) * sy) / l2, 0, 1);
            const d2 = (px - ax - sx * t) ** 2 + (py - ay - sy * t) ** 2;
            if (d2 < best) {
              best = d2;
              const l = Math.sqrt(l2);
              bu = arc[i] + t * l;
              tx = sx / l;
              ty = sy / l;
              side = sx * (py - ay) - sy * (px - ax) >= 0 ? 1 : -1;
            }
          }
          const a = Math.sqrt(best);
          const s = bu / total;
          const u = s * L;
          // Outward normal on this side.
          const nx = -ty * side;
          const ny = tx * side;
          const w = this.halfWidth(s, L);
          const band = (Math.abs(ny) * ch + Math.abs(nx) * cw) * 0.6;
          const sec = this.sectionAt(s);
          let glyph = "";
          let color = "";
          let fill = "";

          if (a <= w) {
            const seam = this.bounds.slice(0, -1).some((b) => Math.abs(s - b) * total < Math.min(cw, ch) * 0.55);
            if (eyeCells.has(r * cols + c)) {
              glyph = "o";
              color = eyeCol;
            } else if (a > w - band || s < 0.012) {
              // Contour: the edge runs along the spine, tilted by how fast the width changes.
              const dw = (this.halfWidth(Math.min(1, s + 0.01), L) - this.halfWidth(Math.max(0, s - 0.01), L)) / (0.02 * L);
              glyph = lineGlyph(tx + nx * dw, ty + ny * dw, cw, ch);
              color = edgeCol[sec];
            } else if (seam) {
              // Section seam: a line straight across the body.
              glyph = lineGlyph(nx, ny, cw, ch);
              color = seamCol[sec];
            } else {
              // Inside: the section's own words, laid along the body.
              const text = this.site.sections[sec].headline;
              const line = text + "  ·  ";
              const idx = c + r * 7;
              const chr = line[idx % line.length];
              glyph = chr === " " ? "" : chr === "·" ? "·" : chr;
              color = textCol[sec];
            }
            if (this.opts.style === "soft") fill = fillCol[sec];
          } else {
            // Fins (pages) and the tail fork.
            for (let p = 0; p < fins.length && !glyph; p++) {
              const f = fins[p];
              if (!inTriangle(u, a, f.u0, 0, f.u1, 0, f.u2, f.reach)) continue;
              const page = this.site.pages[p * 2 + (side > 0 ? 0 : 1)];
              if (!page) break;
              const e1 = segDist(u, a, f.u0, 0, f.u2, f.reach);
              const e2 = segDist(u, a, f.u1, 0, f.u2, f.reach);
              const fb = (cw + ch) * 0.32;
              if (Math.min(e1, e2) < fb) {
                const [du, da] = e1 < e2 ? [f.u2 - f.u0, f.reach] : [f.u2 - f.u1, f.reach];
                glyph = lineGlyph(tx * du + nx * da, ty * du + ny * da, cw, ch);
                color = finCol;
              } else {
                const chr = page[(c + r * 3) % page.length];
                glyph = chr;
                color = finText;
              }
            }
            if (!glyph && inTriangle(u, a, L * 0.88, 0, L * 0.96, 0, L * 1.0, L * 0.075)) {
              glyph = lineGlyph(tx * 0.08 + nx * 0.075, ty * 0.08 + ny * 0.075, cw, ch);
              color = edgeCol[nSec - 1];
            }
          }

          if (!glyph && !fill) continue;
          occupied[r * cols + c] = 1;
          if (fill) {
            ctx.fillStyle = fill;
            ctx.fillRect(c * cw + 1, r * ch + 1, cw - 1, ch - 1);
          }
          if (glyph) {
            ctx.fillStyle = color;
            ctx.fillText(glyph, px, py + 1);
          }
        }
      }
    }

    // Visitors: one dash per ~N visits in the last 24h.
    ctx.fillStyle = fishCol;
    for (const f of this.world.fish) {
      if (!f.alive) continue;
      const c = Math.floor(f.x / cw);
      const r = Math.floor(f.y / ch);
      if (c < 0 || r < 0 || c >= cols || r >= rows || occupied[r * cols + c]) continue;
      occupied[r * cols + c] = 1;
      ctx.fillText("-", c * cw + cw / 2, r * ch + ch / 2 + 1);
    }
  }
}
