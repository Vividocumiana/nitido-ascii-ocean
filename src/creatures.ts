/**
 * Single-creature renderer for small surfaces (plan cards, empty states).
 *
 * Motion: the head steers along a smooth noise path; the body is laid along
 * the exact trail the head has swum (path following), so it never kinks or
 * jitters. A travelling wave is added on top at render time. The sim runs on
 * real frame time split into small substeps, so there's no fixed-step judder.
 *
 * Drawing: cells are classified against the body (a width profile along the
 * spine) and its fins (paddles, blades and tails defined in fin space).
 * Cells near an outline are supersampled 4×4, so coverage is continuous and
 * the silhouette glides across the grid instead of popping cell to cell.
 */
import { angleDiff, clamp, hash3, smoothstep, TAU } from "./math";
import { hexRgb } from "./config";

type RGB = [number, number, number];
type Vec = { x: number; y: number };

const mix = (a: RGB, b: RGB, k: number): RGB => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
const mul = (a: RGB, k: number): RGB => [a[0] * k, a[1] * k, a[2] * k];
const rgba = (c: RGB, a = 1) => `rgba(${clamp(Math.round(c[0]), 0, 255)},${clamp(Math.round(c[1]), 0, 255)},${clamp(Math.round(c[2]), 0, 255)},${a.toFixed(3)})`;

const SKIN_RAMP = ":;t%SX8#@";
const EDGE_GLYPHS = ".',`";
const NODES = 40;
const SUB = 4; // supersampling per axis on outline cells

/** Smooth 1D noise in [-1, 1]. */
function noise1(x: number, seed: number) {
  const i = Math.floor(x);
  const f = x - i;
  const u = f * f * (3 - 2 * f);
  return (hash3(i, seed, 1) * (1 - u) + hash3(i + 1, seed, 1) * u) * 2 - 1;
}

/** Smooth 2D value noise in [0, 1). */
function vnoise(x: number, y: number, seed: number) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const u = smoothstep(0, 1, x - xi);
  const v = smoothstep(0, 1, y - yi);
  const a = hash3(xi, yi, seed);
  const b = hash3(xi + 1, yi, seed);
  const c = hash3(xi, yi + 1, seed);
  const d = hash3(xi + 1, yi + 1, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

/** Line glyph for a direction, in cell units so diagonals match the cell aspect. */
function rayGlyph(dx: number, dy: number, cw: number, ch: number) {
  let a = Math.atan2(dy / ch, dx / cw);
  if (a < 0) a += Math.PI;
  const e = Math.PI / 8;
  if (a < e || a > 7 * e) return "-";
  if (a < 3 * e) return "\\";
  if (a < 5 * e) return "|";
  return "/";
}

// ── anatomy ────────────────────────────────────────────────────────────

/** A paired side fin, or a barbel. Lengths are fractions of body length L. */
export interface SideFin {
  /** Anchor along the body, 0 snout → 1 tail stalk. */
  s: number;
  /** Rest angle away from the body axis (0 = lying back along the body). */
  angle: number;
  len: number;
  /** Max half-width as a fraction of the fin's own length. */
  width: number;
  shape: "paddle" | "blade" | "whisker";
  flap: number;
  /** Flap rate relative to the tail beat. */
  flapRate: number;
  /** 0..1: how flat the fin folds against the body while the tail is driving. */
  fold?: number;
  /** Extra flap (sculling) when the fish is slow or hovering. */
  scull?: number;
  /** Side-view creatures: 1 = only on the back (dorsal fin), −1 = only on the belly (flipper). */
  only?: 1 | -1;
  phase: number;
  /** Curl that travels down the fin, for soft trailing edges. */
  bend: number;
  alpha: number;
}

export interface TailFin {
  len: number;
  /** Half-span at the trailing edge, as a fraction of the tail length. */
  span: number;
  /** How far the middle of the trailing edge cuts in (0 = straight, 1 = fully forked). */
  notch: number;
  /** Leading edge swept back toward the tips (dolphin flukes). */
  sweep: number;
  /** Lag of the tail behind the body wave (rad). */
  lag: number;
  /** Flowing curl along the tail. */
  bend: number;
  /** Up-down beat seen from above: the flukes foreshorten each stroke. */
  pitch: number;
  alpha: number;
}

/**
 * How the creature spends its effort:
 *   continuous: steady tail beat (koi)
 *   burst: a few quick beats, a coast, now and then a hover in place (goldfish)
 *   stroke: a few fluke strokes, then a long glide (dolphin)
 */
export interface Gait {
  kind: "continuous" | "burst" | "stroke";
  beats: [number, number];
  coast: [number, number];
  /** Water drag on the body, per second (higher = coasts stop sooner). */
  drag: number;
  /** Chance per second of stopping to hover (burst gait). */
  hover?: number;
  hoverTime?: [number, number];
  /** Turning on the spot when slow (rad/s). */
  pivot?: number;
}

export interface CreatureDef {
  name: string;
  gait: Gait;
  /** "top": seen from above, symmetric. "side": seen in profile, back and belly differ. */
  view?: "top" | "side";
  /** Side view: half-height of the back and belly above/below the spine, fraction of L. */
  profile?: { back: (s: number) => number; belly: (s: number) => number };
  /** How a group behaves: circle each other, play in pairs, or a loose school. */
  social: "orbit" | "play" | "school";
  /** Rolls into turns (dolphin): the body narrows and the pale flank shows. */
  bank?: number;
  /** Half-width along the body, fraction of L. s: 0 snout → 1 tail stalk. */
  width: (s: number) => number;
  fins: SideFin[];
  tail: TailFin;
  /** Lateral body wave. */
  wave: { amp: number; wavelength: number; head: number };
  /** Tail beats per second at cruise. */
  beat: number;
  /** Cruise speed in body lengths per second. */
  cruise: number;
  /** Speed pulses with each stroke (goldfish glide-and-kick). */
  surge: number;
  /** Tightest turn radius, in body lengths. */
  turnRadius: number;
  /** Most the whole body can bend, head to tail (rad): ~2.4 is a tight C, ~1 a stiff dolphin. */
  stiffness: number;
  eyes: { s: number; across: number; glyph: string };
  /** Base skin colour at a body point. across: 0 spine → 1 outline. */
  skin: (s: number, across: number, side: number, u: number, v: number, seed: number, roll: number) => RGB;
  /** Narrow highlight or shadow along the back (dorsal fin seen from above). */
  ridge?: { s0: number; s1: number; width: number; shade: number };
  fin: RGB;
  accent: RGB;
  /** Odds of an accent glyph on a body cell. */
  accentRate: number;
  /** Extra marks: blowhole etc. */
  marks?: { s: number; across: number; glyph: string }[];
}

const hex = hexRgb;

export const CREATURES: Record<string, CreatureDef> = {
  // Common goldfish seen from above: a slim teardrop (about 5:1), widest just behind the
  // eyes, a short narrow stalk. The caudal fin is vertical, so from above it reads as a
  // narrow forked blade that whips side to side, not a fan.
  goldfish: {
    name: "Goldfish",
    social: "school",
    gait: { kind: "burst", beats: [2, 4], coast: [0.35, 1.1], drag: 1.6, hover: 0.12, hoverTime: [1.2, 3], pivot: 1.6 },
    width: (s) => {
      if (s < 0.12) return 0.098 * Math.pow(Math.sin(((s / 0.12) * Math.PI) / 2), 0.55);
      if (s < 0.3) return 0.098 + 0.014 * smoothstep(0.12, 0.3, s);
      return 0.026 + 0.086 * Math.pow(1 - (s - 0.3) / 0.7, 1.2);
    },
    fins: [
      // Pectorals scull while hovering and fold back during a burst.
      { s: 0.2, angle: 1.05, len: 0.15, width: 0.42, shape: "paddle", flap: 0.25, flapRate: 1.4, phase: 0, bend: 0.3, alpha: 0.5, fold: 0.85, scull: 0.55 },
      { s: 0.5, angle: 0.55, len: 0.09, width: 0.38, shape: "paddle", flap: 0.15, flapRate: 1.1, phase: 1.3, bend: 0.3, alpha: 0.45, fold: 0.6, scull: 0.2 },
    ],
    tail: { len: 0.34, span: 0.26, notch: 0.55, sweep: 0, lag: 0.6, bend: 0.35, pitch: 0, alpha: 0.6 },
    wave: { amp: 0.09, wavelength: 0.95, head: 0.04 },
    beat: 3.6,
    cruise: 0.55,
    surge: 0,
    turnRadius: 0.3,
    stiffness: 1.9,
    eyes: { s: 0.11, across: 0.92, glyph: "o" },
    skin: (s, across) => {
      const back = mix(hex("#d9481c"), hex("#f2873a"), smoothstep(0.15, 0.95, across));
      return mix(back, hex("#f5a24e"), 0.3 * smoothstep(0.2, 0, s));
    },
    // Dorsal fin seen edge-on: a thin darker line down the back.
    ridge: { s0: 0.3, s1: 0.62, width: 0.14, shade: -0.22 },
    fin: hex("#f39a55"),
    accent: hex("#b8321a"),
    accentRate: 0.05,
  },

  koi: {
    name: "Koi",
    social: "orbit",
    gait: { kind: "continuous", beats: [1, 1], coast: [0, 0], drag: 1.2 },
    // Torpedo: blunt rounded head, fullest at a third, long tapering stalk.
    width: (s) => {
      const body = 0.132 * Math.pow(Math.sin(Math.PI * Math.pow(clamp(s, 0, 1), 0.68)), 0.62);
      return Math.max(body, 0.032 * smoothstep(0.7, 0.9, s));
    },
    fins: [
      { s: 0.24, angle: 1.05, len: 0.2, width: 0.48, shape: "paddle", flap: 0.28, flapRate: 0.7, phase: 0, bend: 0.2, alpha: 0.72 },
      { s: 0.56, angle: 0.6, len: 0.1, width: 0.36, shape: "paddle", flap: 0.2, flapRate: 0.6, phase: 1.1, bend: 0.25, alpha: 0.65 },
      // Barbels at the corners of the mouth.
      { s: 0.025, angle: 0.55, len: 0.06, width: 0.08, shape: "whisker", flap: 0.15, flapRate: 0.9, phase: 0.4, bend: 0.4, alpha: 0.7 },
    ],
    tail: { len: 0.3, span: 0.62, notch: 0.32, sweep: 0, lag: 0.35, bend: 0.2, pitch: 0, alpha: 0.92 },
    wave: { amp: 0.06, wavelength: 0.85, head: 0.04 },
    beat: 1.1,
    cruise: 0.22,
    surge: 0.08,
    turnRadius: 0.45,
    stiffness: 2.0,
    eyes: { s: 0.075, across: 0.72, glyph: "o" },
    skin: (s, across, _side, u, v, seed) => {
      const ivory = mix(hex("#f1ece3"), hex("#e2dbcf"), across * across);
      if (s > 0.86) return ivory;
      // Kohaku-style patches: low-frequency noise in body space, unique per fish.
      const n = vnoise(u / 0.11, v / 0.075, seed) * 0.7 + vnoise(u / 0.05, v / 0.035, seed + 7) * 0.3;
      const k = smoothstep(0.5, 0.56, n);
      return mix(ivory, hex(KOI_PATCH.color), k);
    },
    ridge: { s0: 0.34, s1: 0.7, width: 0.1, shade: -0.06 },
    fin: hex("#ece6db"),
    accent: hex("#DF4125"),
    accentRate: 0.03,
  },

  // Bottlenose dolphin in profile: short beak, rounded melon, a high arched back with a
  // swept dorsal fin, a flipper under the chest, a long tail stock and forked flukes.
  // It swims with up-and-down strokes, so seen from the side the whole body flexes in a
  // wave and travels in long arcs. Dark back, grey flanks, pale belly.
  dolphin: {
    name: "Dolphin",
    social: "play",
    view: "side",
    gait: { kind: "stroke", beats: [2, 4], coast: [0.6, 1.4], drag: 0.5 },
    profile: {
      back: (s) => {
        if (s < 0.06) return 0.014 + 0.004 * (s / 0.06);
        if (s < 0.16) return 0.018 + 0.07 * Math.pow(smoothstep(0.06, 0.16, s), 0.8);
        if (s < 0.4) return 0.088 + 0.022 * smoothstep(0.16, 0.4, s);
        return 0.016 + 0.094 * Math.pow(1 - (s - 0.4) / 0.6, 1.45);
      },
      belly: (s) => {
        if (s < 0.06) return 0.01;
        if (s < 0.2) return 0.01 + 0.06 * smoothstep(0.06, 0.2, s);
        if (s < 0.45) return 0.07 + 0.015 * smoothstep(0.2, 0.45, s);
        return 0.012 + 0.073 * Math.pow(1 - (s - 0.45) / 0.55, 1.3);
      },
    },
    width: (s) => {
      // Used for bounds and fin anchors: the larger of back and belly.
      const p = CREATURES.dolphin.profile!;
      return Math.max(p.back(s), p.belly(s));
    },
    fins: [
      // Dorsal fin: tall, swept back, curved trailing edge.
      { s: 0.43, angle: 1.0, len: 0.115, width: 0.72, shape: "blade", flap: 0.03, flapRate: 0.5, phase: 0, bend: 0.12, alpha: 1, only: 1 },
      // Flipper under the chest.
      { s: 0.24, angle: 0.62, len: 0.13, width: 0.36, shape: "blade", flap: 0.12, flapRate: 1, phase: 0.6, bend: 0.05, alpha: 1, only: -1 },
    ],
    tail: { len: 0.13, span: 0.95, notch: 0.55, sweep: 0.35, lag: 0.25, bend: 0.1, pitch: 0, alpha: 1 },
    wave: { amp: 0.045, wavelength: 0.72, head: 0.1 },
    beat: 1.6,
    cruise: 0.5,
    surge: 0,
    turnRadius: 0.38,
    stiffness: 1.5,
    eyes: { s: 0.11, across: 0.25, glyph: "o" },
    skin: (_s, across, side) => {
      // side: 1 = back, −1 = belly. Signed position from belly (−1) to back (+1).
      const y = across * side;
      const back = hex("#46525e");
      const flank = hex("#8693a0");
      const belly = hex("#d6dce1");
      return mix(mix(belly, flank, smoothstep(-0.75, -0.1, y)), back, smoothstep(0.05, 0.7, y));
    },
    fin: hex("#4b5763"),
    accent: hex("#7fa7c9"),
    accentRate: 0.015,
  },
};

/** Koi patch colour is shared and tweakable from the page. */
export const KOI_PATCH = { color: "#DF4125" };

/** How far anything (body, fins, tail, wave) reaches sideways from the swum path, fraction of L. */
const reachCache = new Map<CreatureDef, number>();
function reachOf(def: CreatureDef) {
  let r = reachCache.get(def);
  if (r !== undefined) return r;
  const half = (s: number) => (def.profile ? Math.max(def.profile.back(s), def.profile.belly(s)) : def.width(s));
  let w = 0;
  for (let s = 0; s <= 1; s += 0.02) w = Math.max(w, half(s));
  r = w + def.wave.amp;
  for (const f of def.fins) r = Math.max(r, half(f.s) + f.len * Math.sin(Math.min(Math.PI / 2, f.angle + f.flap)) + def.wave.amp * 0.5);
  r = Math.max(r, def.tail.span * def.tail.len + def.wave.amp);
  reachCache.set(def, r);
  return r;
}

// ── motion ─────────────────────────────────────────────────────────────

class Swimmer {
  x = 0;
  y = 0;
  heading = 0;
  omega = 0;
  speed = 0;
  /** Tail-beat phase. */
  phase = 0;
  t = 0;
  /** 0 coasting / hovering → 1 tail driving. Smoothed, drives the body wave. */
  activity = 1;
  /** Bank angle proxy, signed. */
  roll = 0;
  /** Size relative to the scene's base length. */
  scale = 1;
  /** Side view: which side of the spine is the back (+1/−1), and a turn-toward-camera in progress. */
  dorsal = 1;
  flip = 0;
  private mode: "swim" | "coast" | "hover" = "swim";
  private beatsLeft = 3;
  private modeUntil = 0;
  private lastBeat = 0;
  private outside = 0;
  /** Side view: which way the current long pass runs (+1 right, −1 left). */
  private pass: 1 | -1 = 1;
  /** Head trail, newest last. */
  private trail: number[] = [];

  constructor(public seed: number) {}

  reset(x: number, y: number, heading: number, L: number) {
    this.x = x;
    this.y = y;
    this.heading = heading;
    this.trail = [];
    const step = 2;
    for (let d = L * 2; d >= 0; d -= step) this.trail.push(x - Math.cos(heading) * d, y - Math.sin(heading) * d);
  }

  private rand(k: number) {
    return hash3(Math.floor(this.t * 7.3) + k, this.seed, 41);
  }

  /** Advance the gait: which phase of swimming we're in, and how hard the tail drives. */
  private gait(dt: number, def: CreatureDef) {
    const g = def.gait;
    let drive = 1;
    if (g.kind !== "continuous") {
      const beatIndex = Math.floor(this.phase / TAU);
      if (this.mode === "swim") {
        if (beatIndex > this.lastBeat) {
          this.lastBeat = beatIndex;
          if (--this.beatsLeft <= 0) {
            const hover = g.hover && this.rand(1) < g.hover * 2.5;
            this.mode = hover ? "hover" : "coast";
            const [a, b] = hover ? g.hoverTime! : g.coast;
            this.modeUntil = this.t + a + (b - a) * this.rand(2);
          }
        }
      } else if (this.t >= this.modeUntil) {
        this.mode = "swim";
        this.lastBeat = Math.floor(this.phase / TAU);
        this.beatsLeft = g.beats[0] + Math.round((g.beats[1] - g.beats[0]) * this.rand(3));
      }
      drive = this.mode === "swim" ? 1 : this.mode === "hover" ? 0.12 : 0;
      if (this.outside > 0.5 && this.mode !== "swim") this.modeUntil = Math.min(this.modeUntil, this.t + 0.2);
    }
    this.activity += (drive - this.activity) * Math.min(1, dt * (drive > this.activity ? 9 : 3));
    return drive;
  }

  get hovering() {
    return this.mode === "hover";
  }

  /** Own wandering target: a smooth noise path around the area. */
  wander(area: { x0: number; y0: number; x1: number; y1: number }, speedK: number, def?: CreatureDef, L = 0) {
    const t = this.t;
    const cx = (area.x0 + area.x1) / 2;
    const cy = (area.y0 + area.y1) / 2;
    if (def?.view === "side") {
      // In profile: long, nearly level passes from one end to the other, gently rising and
      // falling, and a turn only at the ends. Wandering about would mean looping all the time.
      if (this.pass > 0 && this.x > area.x1 - L * 0.5) this.pass = -1;
      else if (this.pass < 0 && this.x < area.x0 + L * 0.5) this.pass = 1;
      return {
        x: this.pass > 0 ? area.x1 + L : area.x0 - L,
        y: cy + ((area.y1 - area.y0) / 2) * 0.7 * noise1(t * 0.09 * speedK, this.seed + 11),
      };
    }
    const f = 0.045 * speedK;
    return {
      x: cx + ((area.x1 - area.x0) / 2) * (0.75 * noise1(t * f, this.seed) + 0.25 * noise1(t * f * 2.7, this.seed + 3)),
      y: cy + ((area.y1 - area.y0) / 2) * (0.75 * noise1(t * f, this.seed + 11) + 0.25 * noise1(t * f * 2.7, this.seed + 17)),
    };
  }

  step(dt: number, def: CreatureDef, L: number, area: { x0: number; y0: number; x1: number; y1: number }, speedK: number, target?: { x: number; y: number }, push = 0) {
    this.t += dt;
    const t = this.t;
    const cx = (area.x0 + area.x1) / 2;
    const cy = (area.y0 + area.y1) / 2;
    const tgt = target ?? this.wander(area, speedK, def, L);
    const tx = tgt.x;
    const ty = tgt.y;
    // How far the head has strayed outside its area (0 inside → 1 well out).
    const ox = Math.max(area.x0 - this.x, this.x - area.x1, 0) / (L * 0.25);
    const oy = Math.max(area.y0 - this.y, this.y - area.y1, 0) / (L * 0.25);
    const out = clamp(Math.max(ox, oy, push), 0, 1);
    let desired = Math.atan2(ty + (cy - ty) * out - this.y, tx + (cx - tx) * out - this.x);
    if (def.view === "side" && Math.cos(desired) * Math.cos(this.heading) > 0) {
      // In profile, travel mostly level in long arcs; steep climbs and dives only to get
      // back in bounds. (Turning around is still free: that's a loop and a roll.)
      const level = Math.cos(desired) >= 0 ? 0 : Math.PI;
      const lim = 0.5 + 0.6 * out;
      desired = level + clamp(angleDiff(level, desired), -lim, lim);
    }

    this.outside = out;
    const drive = this.gait(dt, def);
    const cruise = def.cruise * L * speedK;
    const g = def.gait;
    if (g.kind === "continuous") {
      const target = cruise * (0.85 + 0.25 * noise1(t * 0.13, this.seed + 5));
      this.speed += (target - this.speed) * Math.min(1, dt * 2.2);
    } else {
      // Thrust while the tail drives, drag always: bursts overshoot cruise, coasts decay.
      const accel = cruise * g.drag * 1.7;
      this.speed += (drive * accel - this.speed * g.drag) * dt;
      // Never fully stalls: a hovering fish still drifts, which also lets the body turn.
      this.speed = Math.max(this.speed, cruise * 0.08);
    }

    // Turn: limited by a turning circle at speed, plus an on-the-spot pivot when slow.
    const slow = 1 - clamp(this.speed / (cruise || 1), 0, 1);
    const maxOmega = (this.speed / (def.turnRadius * L)) * (1 + 2.5 * out) + (g.pivot ?? 0) * slow * speedK;
    // Close to the target, stop chasing it (no circling); it drifts on and pulls again later.
    const dist = Math.hypot(tx - this.x, ty - this.y);
    const pull = Math.max(out, smoothstep(L * 0.25, L * 1.1, dist));
    const wantOmega = clamp(angleDiff(this.heading, desired) * 1.1 * pull, -maxOmega, maxOmega);
    this.omega += (wantOmega - this.omega) * Math.min(1, dt * (1.8 + 3 * out));
    this.heading += this.omega * dt;
    this.x += Math.cos(this.heading) * this.speed * dt;
    this.y += Math.sin(this.heading) * this.speed * dt;
    // The tail-beat clock runs fast while driving and nearly stops while coasting.
    this.phase += dt * TAU * def.beat * (0.15 + 0.85 * this.activity) * speedK;
    if (def.bank) this.roll += (clamp(this.omega * def.bank * 1.4, -0.9, 0.9) - this.roll) * Math.min(1, dt * 2);

    // Record the trail at ~1px spacing.
    const n = this.trail.length;
    const lx = this.trail[n - 2];
    const ly = this.trail[n - 1];
    if (Math.hypot(this.x - lx, this.y - ly) >= 1) this.trail.push(this.x, this.y);
    if (this.trail.length > 6000) this.trail.splice(0, this.trail.length - 4000);
  }

  /** Lay NODES points back along the trail, `L` long. */
  spine(out: Float32Array, L: number, stiffness = 3) {
    const tr = this.trail;
    const seg = L / (NODES - 1);
    out[0] = this.x;
    out[1] = this.y;
    let px = this.x;
    let py = this.y;
    let need = seg;
    let k = 1;
    for (let i = tr.length - 2; i >= 0 && k < NODES; i -= 2) {
      const qx = tr[i];
      const qy = tr[i + 1];
      let d = Math.hypot(qx - px, qy - py);
      while (d >= need && k < NODES) {
        const r = need / d;
        px += (qx - px) * r;
        py += (qy - py) * r;
        out[k * 2] = px;
        out[k * 2 + 1] = py;
        k++;
        d = Math.hypot(qx - px, qy - py);
        need = seg;
      }
      need -= d;
      px = qx;
      py = qy;
    }
    // Trail too short (shouldn't happen after reset): extend straight back.
    for (; k < NODES; k++) {
      out[k * 2] = out[(k - 1) * 2] - Math.cos(this.heading) * seg;
      out[k * 2 + 1] = out[(k - 1) * 2 + 1] - Math.sin(this.heading) * seg;
    }
    // Body stiffness: a spine can only bend so far per joint. Where the trail curls tighter,
    // the body cuts the corner and swings round instead of wrapping into a U.
    const maxBend = stiffness / (NODES - 2);
    let prev = Math.atan2(out[1] - out[3], out[0] - out[2]) + Math.PI;
    for (let j = 1; j < NODES; j++) {
      const px = out[(j - 1) * 2];
      const py = out[(j - 1) * 2 + 1];
      let ang = Math.atan2(out[j * 2 + 1] - py, out[j * 2] - px);
      if (j > 1) ang = prev + clamp(angleDiff(prev, ang), -maxBend, maxBend);
      out[j * 2] = px + Math.cos(ang) * seg;
      out[j * 2 + 1] = py + Math.sin(ang) * seg;
      prev = ang;
    }
  }
}

// ── scene ──────────────────────────────────────────────────────────────

export interface CreatureOptions {
  creature: string;
  /** Body length as a fraction of canvas height. */
  size: number;
  cell: number;
  background: string;
  /** 1 = full colour; lower melts into the background. */
  opacity: number;
  speed: number;
  grid: boolean;
  debug: boolean;
  /** Where the creature roams, as fractions of the canvas. */
  area: { x0: number; y0: number; x1: number; y1: number };
  /** How many in the scene. */
  count: number;
  /** No part of a body goes left of this (fraction of width), e.g. to keep clear of text. */
  wall?: number;
  /**
   * Keep every body whole inside the canvas, right of `wall`, `pad` px from the edges:
   * nothing is ever cut by the frame. Bodies are capped in size so they can turn round
   * inside that box, and they start turning before they reach its sides.
   */
  contain?: { pad: number };
  /** Don't paint the background (layer several scenes); `background` is still used for blending. */
  transparent?: boolean;
  /**
   * Swim round an ellipse instead of wandering (fractions of width/height from the centre),
   * e.g. to circle a window placed over the middle. speed: 1 = the creature's own cruising
   * pace round the ring, negative = the other way.
   */
  ring?: { rx: number; ry: number; speed: number; phase: number };
}

interface FinPose {
  fin: SideFin;
  side: number;
  ax: number;
  ay: number;
  /** Fin axis (unit) and its perpendicular. */
  dx: number;
  dy: number;
  px: number;
  py: number;
  len: number;
  bendPhase: number;
}

export class CreatureScene {
  private ctx: CanvasRenderingContext2D;
  private swimmer: Swimmer;
  private swimmers: Swimmer[] = [];
  private W = 0;
  private H = 0;
  private dpr = 1;
  private raf = 0;
  private last = 0;
  private visible = true;
  private nodes = new Float32Array(NODES * 2);
  private spine = new Float32Array(NODES * 2);
  private tan = new Float32Array(NODES * 2);
  private arc = new Float32Array(NODES);
  private ro: ResizeObserver;
  private io: IntersectionObserver;
  /** Frame time, for the debug readout. */
  frameMs = 0;
  private frameDt = 1 / 60;
  private probe = new Float32Array(NODES * 2);

  constructor(
    private canvas: HTMLCanvasElement,
    public opts: CreatureOptions,
    private seed = 1,
  ) {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("2D canvas unavailable");
    this.ctx = ctx;
    this.swimmer = new Swimmer(seed);
    this.swimmers = [this.swimmer];
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(canvas);
    this.io = new IntersectionObserver(([e]) => (this.visible = e.isIntersecting));
    this.io.observe(canvas);
    this.resize();
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    this.io.disconnect();
  }

  get def() {
    return CREATURES[this.opts.creature] ?? CREATURES.goldfish;
  }

  /** Body length of the swimmer being processed. Groups are a little smaller each. */
  get L() {
    const n = this.swimmers.length;
    return this.baseL() * this.swimmer.scale / (1 + 0.16 * (n - 1));
  }

  /** Body length before group shrink; in a box, no bigger than lets it turn round inside. */
  private baseL() {
    const L = this.H * this.opts.size;
    const b = this.box();
    if (!b) return L;
    const def = this.def;
    const fit = Math.min(b.x1 - b.x0, b.y1 - b.y0) / (2 * def.turnRadius + 2 * reachOf(def) + 0.5);
    return Math.max(8, Math.min(L, fit));
  }

  /**
   * Cell width actually drawn. In a box, a body shrunk to fit keeps its detail: the grid
   * gets finer so the body stays at least ~16 cells long.
   */
  private cellW() {
    const c = this.opts.cell;
    if (!this.opts.contain) return c;
    const n = Math.max(1, Math.round(this.opts.count));
    return clamp(Math.round(this.baseL() / (1 + 0.16 * (n - 1)) / 16), Math.min(4, c), c);
  }

  /** The box every body stays inside (px), when contained. */
  private box() {
    const c = this.opts.contain;
    if (!c) return null;
    // A cell the outline only grazes is still painted whole: keep a cell more in hand.
    const p = c.pad + this.opts.cell * 1.45;
    return { x0: (this.opts.wall ?? 0) * this.W + p, y0: p, x1: this.W - p, y1: this.H - p };
  }

  private area() {
    const b = this.box();
    if (b) {
      // Where the head may go: the box less what sticks out sideways from the path.
      const m = reachOf(this.def) * this.baseL() * 1.1;
      const x0 = b.x0 + m, x1 = Math.max(x0 + 1, b.x1 - m);
      const y0 = b.y0 + m, y1 = Math.max(y0 + 1, b.y1 - m);
      return { x0, y0, x1, y1 };
    }
    const a = this.opts.area;
    return { x0: a.x0 * this.W, y0: a.y0 * this.H, x1: a.x1 * this.W, y1: a.y1 * this.H };
  }

  /** (Re)populate the scene: count swimmers spread over the area, a few seconds into their swim. */
  restart() {
    const a = this.area();
    const n = Math.max(1, Math.round(this.opts.count));
    this.swimmers = [];
    for (let i = 0; i < n; i++) {
      const sw = new Swimmer(this.seed * 100 + i * 17 + 1);
      sw.scale = n === 1 ? 1 : 0.86 + 0.24 * hash3(this.seed, i, 5);
      this.swimmer = sw;
      const fx = n === 1 ? 0.5 : 0.2 + 0.6 * hash3(this.seed, i, 6);
      const fy = n === 1 ? 0.5 : 0.2 + 0.6 * hash3(this.seed, i, 7);
      const ring = this.opts.ring;
      if (ring) {
        // Start on the ring, already heading along it.
        const th = ring.phase + (hash3(this.seed, i, 8) - 0.5) * 0.3;
        const x = this.W * (0.5 + ring.rx * Math.cos(th)) + (fx - 0.5) * this.L;
        const y = this.H * (0.5 + ring.ry * Math.sin(th)) + (fy - 0.5) * this.L;
        sw.reset(x, y, th + Math.sign(ring.speed || 1) * Math.PI / 2, this.L);
      } else sw.reset(a.x0 + (a.x1 - a.x0) * fx, a.y0 + (a.y1 - a.y0) * fy, hash3(this.seed, i, 2) * TAU, this.L);
      this.swimmers.push(sw);
    }
    // Swim a few seconds so they start mid-stride and already in formation.
    for (let i = 0; i < 300; i++) this.stepAll(1 / 60);
    // Draw smaller ones first, so bigger ones swim over them.
    this.swimmers.sort((p, q) => p.scale - q.scale);
  }

  setCount(n: number) {
    this.opts.count = n;
    this.restart();
  }

  /** Group behaviour → one target per swimmer, plus personal space between them. */
  private stepAll(dt: number) {
    const a = this.area();
    const def = this.def;
    const sws = this.swimmers;
    const n = sws.length;
    if (n === 0) return;
    const t = sws[0].t;
    // A shared, slowly drifting centre for the group (or a point travelling round the ring).
    const ring = this.opts.ring;
    const ringAt = (th: number) => ({
      x: this.W * (0.5 + ring!.rx * Math.cos(th)),
      y: this.H * (0.5 + ring!.ry * Math.sin(th)),
    });
    // Travel round the ring at a bit under cruising pace, so the group keeps up with it.
    const ringR = ring ? (ring.rx * this.W + ring.ry * this.H) / 2 : 1;
    const ringW = ring ? (ring.speed * 0.7 * def.cruise * this.H * this.opts.size) / ringR : 0;
    const ringTh = ring ? ring.phase + t * ringW * this.opts.speed : 0;
    const g = ring
      ? ringAt(ringTh)
      : {
          x: (a.x0 + a.x1) / 2 + ((a.x1 - a.x0) / 2) * 0.55 * noise1(t * 0.035, this.seed + 91),
          y: (a.y0 + a.y1) / 2 + ((a.y1 - a.y0) / 2) * 0.55 * noise1(t * 0.035, this.seed + 97),
        };
    const gx = g.x;
    const gy = g.y;
    const targets: { x: number; y: number }[] = [];
    for (let i = 0; i < n; i++) {
      const sw = sws[i];
      this.swimmer = sw;
      const L = this.L;
      // On a ring, aim a little ahead along it so the group keeps travelling round.
      let target = ring ? ringAt(ringTh + Math.sign(ring.speed || 1) * 0.35) : sw.wander(a, this.opts.speed, def, L);
      if (n > 1) {
        if (def.social === "orbit") {
          // Chase a point a little further round a shared circle: they wheel round each other.
          const R = L * (0.38 + 0.08 * n);
          const th = Math.atan2(sw.y - gy, sw.x - gx) + 0.85;
          target = { x: gx + Math.cos(th) * R, y: gy + Math.sin(th) * R };
        } else if (def.social === "play") {
          // The first leads; the others swim alongside, weaving over and under it.
          const lead = sws[0];
          if (i > 0) {
            const hx = Math.cos(lead.heading);
            const hy = Math.sin(lead.heading);
            const weave = Math.sin(t * 0.55 + i * 2.1) * L * 0.42;
            const back = L * (0.15 + 0.35 * Math.sin(t * 0.23 + i));
            target = { x: lead.x - hx * back - hy * weave + hx * L * 0.6, y: lead.y - hy * back + hx * weave + hy * L * 0.6 };
          } else {
            // The leader porpoises: long arcs up and down.
            target = { x: target.x, y: target.y + Math.sin(t * 0.7) * (ring ? L * 0.6 : (a.y1 - a.y0) * 0.22) };
          }
        } else {
          // Loose school: everyone keeps a spot around the drifting centre.
          const ox = (hash3(this.seed, i, 11) - 0.5) * L * 1.4;
          const oy = (hash3(this.seed, i, 13) - 0.5) * L * 1.0;
          target = { x: gx + ox + noise1(t * 0.2, sw.seed) * L * 0.3, y: gy + oy + noise1(t * 0.2, sw.seed + 4) * L * 0.3 };
        }
        // Personal space: steer away from heads that are too close.
        for (let j = 0; j < n; j++) {
          if (j === i) continue;
          const o = sws[j];
          const dx = sw.x - o.x;
          const dy = sw.y - o.y;
          const d = Math.hypot(dx, dy) || 1;
          const r = L * 0.5;
          if (d < r) {
            target.x += (dx / d) * (r - d) * 2.2;
            target.y += (dy / d) * (r - d) * 2.2;
          }
        }
      }
      // Targets always sit inside the area (in a box, well clear of its sides).
      const inset = this.opts.contain ? Math.min(def.turnRadius * L * 0.6, (a.x1 - a.x0) / 2, (a.y1 - a.y0) / 2) : 0;
      target.x = clamp(target.x, a.x0 + inset, a.x1 - inset);
      target.y = clamp(target.y, a.y0 + inset, a.y1 - inset);
      targets.push(target);
    }
    for (let i = 0; i < n; i++) {
      const sw = sws[i];
      this.swimmer = sw;
      const L = this.L;
      let push = 0;
      if (this.opts.contain) {
        // Look ahead: the body follows the head's path, so keeping the head inside the area
        // keeps the whole body in the box. Start turning about a turning circle early,
        // sooner the more squarely the head is aimed at a side.
        const R = def.turnRadius * L;
        const look = R * 1.5 + sw.speed * 0.25;
        const hx = Math.cos(sw.heading);
        const hy = Math.sin(sw.heading);
        const near = (d: number, toward: number) => smoothstep(look, 0, d) * (0.3 + 0.7 * Math.max(0, toward));
        push = Math.max(near(sw.x - a.x0, -hx), near(a.x1 - sw.x, hx), near(sw.y - a.y0, -hy), near(a.y1 - sw.y, hy));
      } else if (this.opts.wall !== undefined) {
        // Keep the whole body, not just the head, right of the wall.
        const wall = this.opts.wall * this.W;
        sw.spine(this.probe, L, def.stiffness);
        let minX = Infinity;
        for (let k = 0; k < NODES; k++) minX = Math.min(minX, this.probe[k * 2]);
        // Start turning well before the body reaches the wall, so it rarely slips under the text.
        const margin = L * 0.35 + def.width(0.3) * L;
        push = clamp((wall + margin - minX) / (L * 0.3), 0, 1);
        if (push > 0) targets[i] = { x: Math.max(targets[i].x, wall + (a.x1 - wall) * 0.75), y: targets[i].y };
      }
      sw.step(dt, def, L, a, this.opts.speed, targets[i], push);
    }
  }

  private resize() {
    const r = this.canvas.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return;
    const first = this.W === 0;
    this.W = r.width;
    this.H = r.height;
    this.dpr = Math.min(devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(r.width * this.dpr);
    this.canvas.height = Math.round(r.height * this.dpr);
    if (first) this.restart();
  }

  private frame = (now: number) => {
    this.raf = requestAnimationFrame(this.frame);
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    if (!this.visible || this.W === 0) return;
    // Real frame time, split into small substeps: smooth at any refresh rate.
    const n = Math.max(1, Math.ceil(dt / (1 / 120)));
    for (let i = 0; i < n; i++) this.stepAll(dt / n);
    this.frameDt = dt;
    const t0 = performance.now();
    this.render();
    this.frameMs += (performance.now() - t0 - this.frameMs) * 0.1;
  };

  // ── geometry ───────────────────────────────────────────────────────

  private buildSpine() {
    const { nodes, spine, tan, arc } = this;
    const def = this.def;
    const L = this.L;
    const sw = this.swimmer;
    sw.spine(nodes, L, def.stiffness);
    const wave = def.wave;
    // The body wave comes from the tail driving; coasting bodies straighten out.
    const swim = 0.15 + 0.85 * sw.activity;
    for (let k = 0; k < NODES; k++) {
      const s = k / (NODES - 1);
      const a = Math.max(0, k - 1);
      const b = Math.min(NODES - 1, k + 1);
      let tx = nodes[a * 2] - nodes[b * 2];
      let ty = nodes[a * 2 + 1] - nodes[b * 2 + 1];
      const tl = Math.hypot(tx, ty) || 1;
      tx /= tl;
      ty /= tl;
      // Travelling wave, growing toward the tail.
      const amp = L * wave.amp * (wave.head + (1 - wave.head) * Math.pow(s, 1.6)) * swim;
      const off = amp * Math.sin(sw.phase - s * TAU * wave.wavelength);
      spine[k * 2] = nodes[k * 2] - ty * off;
      spine[k * 2 + 1] = nodes[k * 2 + 1] + tx * off;
    }
    arc[0] = 0;
    for (let k = 1; k < NODES; k++) {
      arc[k] = arc[k - 1] + Math.hypot(spine[k * 2] - spine[k * 2 - 2], spine[k * 2 + 1] - spine[k * 2 - 1]);
    }
    // Unit tangents pointing head → tail, smoothed over neighbours.
    for (let k = 0; k < NODES; k++) {
      const a = Math.max(0, k - 1);
      const b = Math.min(NODES - 1, k + 1);
      const tx = spine[b * 2] - spine[a * 2];
      const ty = spine[b * 2 + 1] - spine[a * 2 + 1];
      const tl = Math.hypot(tx, ty) || 1;
      tan[k * 2] = tx / tl;
      tan[k * 2 + 1] = ty / tl;
    }
  }

  /** Half-thickness of the body at s on one side of the spine (side: +1/−1 as in project()). */
  private half(s: number, side: number) {
    const def = this.def;
    const L = this.L;
    if (!def.profile) return def.width(s) * L;
    const sw = this.swimmer;
    // Rolling round the long axis: the body is nearly round in section, so the outline stays
    // full; the back's edge eases into the belly's shape and vice versa.
    const k = (1 - Math.cos(this.rollAngle())) / 2;
    const back = def.profile.back(s);
    const belly = def.profile.belly(s);
    return (side === sw.dorsal ? back + (belly - back) * k : belly + (back - belly) * k) * L;
  }

  /** Side view: 0 upright → π upside down, while rolling over after a turn. */
  private rollAngle() {
    const f = this.swimmer.flip;
    return f > 0 ? Math.PI * smoothstep(0, 1, f) : 0;
  }

  /** Side view: keep the back on top. When the creature turns around, play a turn toward the camera. */
  private updateDorsal() {
    const sw = this.swimmer;
    if (this.def.view !== "side") return;
    if (sw.flip > 0) {
      // Upside down at the end of the roll looks exactly like upright on the other side.
      sw.flip = Math.min(1, sw.flip + this.frameDt / 0.9);
      if (sw.flip >= 1) {
        sw.flip = 0;
        sw.dorsal = -sw.dorsal as 1 | -1;
      }
      return;
    }
    // Side +1's normal is (−ty, tx); it points up when the tail lies to the left of the head.
    const m = Math.floor(NODES * 0.35);
    const tx = this.tan[m * 2];
    const upIsPlus = tx < 0;
    const want = upIsPlus ? 1 : -1;
    if (want !== sw.dorsal && Math.abs(tx) > 0.35) sw.flip = 0.001;
  }

  /** Point on the render spine at s, with tangent. */
  private at(s: number) {
    const f = clamp(s, 0, 1) * (NODES - 1);
    const k = Math.min(NODES - 2, Math.floor(f));
    const r = f - k;
    const { spine, tan } = this;
    const tx = tan[k * 2] * (1 - r) + tan[k * 2 + 2] * r;
    const ty = tan[k * 2 + 1] * (1 - r) + tan[k * 2 + 3] * r;
    const tl = Math.hypot(tx, ty) || 1;
    return {
      x: spine[k * 2] * (1 - r) + spine[k * 2 + 2] * r,
      y: spine[k * 2 + 1] * (1 - r) + spine[k * 2 + 3] * r,
      tx: tx / tl,
      ty: ty / tl,
    };
  }

  /** Body coords of a point: s along (0..1), signed distance across, and the local frame. */
  private project(px: number, py: number, hint = -1) {
    const { spine, arc } = this;
    let best = Infinity;
    let bu = 0;
    let side = 1;
    let bk = 0;
    const k0 = hint < 0 ? 0 : Math.max(0, hint - 3);
    const k1 = hint < 0 ? NODES - 1 : Math.min(NODES - 1, hint + 4);
    for (let k = k0; k < k1; k++) {
      const ax = spine[k * 2];
      const ay = spine[k * 2 + 1];
      const sx = spine[k * 2 + 2] - ax;
      const sy = spine[k * 2 + 3] - ay;
      const l2 = sx * sx + sy * sy || 1;
      const t = clamp(((px - ax) * sx + (py - ay) * sy) / l2, 0, 1);
      const qx = ax + sx * t;
      const qy = ay + sy * t;
      const d2 = (px - qx) ** 2 + (py - qy) ** 2;
      if (d2 < best) {
        best = d2;
        bu = arc[k] + t * Math.sqrt(l2);
        side = sx * (py - ay) - sy * (px - ax) >= 0 ? 1 : -1;
        bk = k;
      }
    }
    const total = arc[NODES - 1] || 1;
    return { s: bu / total, a: Math.sqrt(best), side, k: bk };
  }

  private finPoses(): FinPose[] {
    const def = this.def;
    const L = this.L;
    const ph = this.swimmer.phase;
    const poses: FinPose[] = [];
    // Rolling: a fin on the back swings toward us (foreshortened), then round to the other side.
    const phi = this.rollAngle();
    for (const fin of def.fins) {
      const proj = fin.only ? fin.only * Math.cos(phi) : 1;
      for (const side of [1, -1]) {
        if (fin.only && side !== Math.sign(proj || 1) * this.swimmer.dorsal) continue;
        const reach = fin.only ? Math.max(Math.abs(proj), fin.only < 0 ? 0.35 : 0) : 1;
        if (reach < 0.08) continue;
        const p = this.at(fin.s);
        // Outward normal on this side.
        const nx = -p.ty * side;
        const ny = p.tx * side;
        const w = this.half(fin.s, side) * (fin.shape === "whisker" ? 0.6 : 0.82) * (fin.only ? Math.max(0.2, Math.abs(proj)) : 1);
        const act = this.swimmer.activity;
        const slow = 1 - act;
        // Sculling when slow (own clock so it keeps going while the tail rests), folded while driving.
        const scull = (fin.scull ?? 0) * slow * Math.sin(this.swimmer.t * TAU * 2.4 + fin.phase + (side > 0 ? 0 : 0.9));
        const flap = fin.flap * Math.sin(ph * fin.flapRate + fin.phase + (side > 0 ? 0 : 0.5)) + scull;
        const ang = fin.angle * (1 - (fin.fold ?? 0) * act) + flap;
        // Lie back along the body (−tangent), rotated outward.
        const dx = -p.tx * Math.cos(ang) + nx * Math.sin(ang);
        const dy = -p.ty * Math.cos(ang) + ny * Math.sin(ang);
        poses.push({
          fin, side,
          ax: p.x + nx * w, ay: p.y + ny * w,
          dx, dy,
          // Perpendicular pointing away from the body side of the fin.
          px: -dy * side, py: dx * side,
          len: fin.len * L * reach,
          bendPhase: ph * fin.flapRate + fin.phase,
        });
      }
    }
    return poses;
  }

  /** Coverage test for one side fin. Returns ray direction when hit. */
  private hitFin(fp: FinPose, x: number, y: number): boolean {
    const rx = x - fp.ax;
    const ry = y - fp.ay;
    const lx = rx * fp.dx + ry * fp.dy;
    if (lx < 0 || lx > fp.len) return false;
    const t = lx / fp.len;
    let ly = rx * fp.px + ry * fp.py;
    // Undo the travelling curl.
    ly -= fp.fin.bend * fp.len * t * t * Math.sin(fp.bendPhase - t * 3);
    const f = fp.fin;
    let hw: number;
    if (f.shape === "paddle") hw = f.width * fp.len * Math.pow(Math.sin(Math.PI * Math.pow(t, 0.55)), 0.7);
    else if (f.shape === "blade") hw = f.width * fp.len * Math.pow(Math.sin(Math.PI * t), 0.8) * (1 - 0.45 * t);
    else hw = Math.max(f.width * fp.len * (1 - t), 0.6);
    // Paddles and blades sit to the trailing side of their axis.
    const lo = f.shape === "whisker" ? -hw : -hw * 0.45;
    return ly >= lo && ly <= hw;
  }

  private tailPose() {
    const def = this.def;
    const L = this.L;
    const tl = def.tail;
    const ph = this.swimmer.phase;
    const p = this.at(1);
    const base = Math.atan2(p.ty, p.tx);
    // Secondary motion: the tail swings behind the body wave.
    const act = this.swimmer.activity;
    const ang = base + tl.lag * (0.25 + 0.75 * act) * Math.sin(ph - TAU * def.wave.wavelength - 1.1);
    // Pitch: flukes beating up and down look shorter at the top and bottom of the stroke.
    const fore = 1 - tl.pitch * act * (0.5 + 0.5 * Math.cos(ph * 2));
    return { x: p.x, y: p.y, dx: Math.cos(ang), dy: Math.sin(ang), len: tl.len * L * fore, ph };
  }

  private hitTail(tp: ReturnType<CreatureScene["tailPose"]>, x: number, y: number) {
    const tl = this.def.tail;
    const rx = x - tp.x;
    const ry = y - tp.y;
    const lx = rx * tp.dx + ry * tp.dy;
    if (lx < 0 || lx > tp.len * 1.05) return false;
    const t = lx / tp.len;
    let ly = -rx * tp.dy + ry * tp.dx;
    ly -= tl.bend * tp.len * t * t * Math.sin(tp.ph - t * 2.6 - 1.4);
    const L = this.L;
    const root = Math.max(this.half(1, 1), this.half(1, -1));
    const span = root + (tl.span * tl.len * L - root) * Math.pow(smoothstep(0, 1, t), 0.65);
    const yn = Math.abs(ly) / span;
    if (yn > 1) return false;
    if (t < tl.sweep * Math.pow(yn, 1.6)) return false;
    return t <= 1 - tl.notch * Math.pow(1 - yn, 1.4);
  }

  // ── drawing ────────────────────────────────────────────────────────

  private render() {
    const { ctx, W, H, dpr, opts } = this;
    const cw = this.cellW();
    const ch = Math.round(cw * 1.45);
    const cols = Math.ceil(W / cw);
    const rows = Math.ceil(H / ch);
    const bg = hexRgb(opts.background);
    const op = opts.opacity;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (opts.transparent) ctx.clearRect(0, 0, W, H);
    else {
      ctx.fillStyle = opts.background;
      ctx.fillRect(0, 0, W, H);
    }
    if (opts.grid) {
      const dark = (0.2126 * bg[0] + 0.7152 * bg[1] + 0.0722 * bg[2]) / 255 < 0.45;
      ctx.strokeStyle = dark ? "rgba(255,255,255,0.045)" : "rgba(0,0,0,0.045)";
      ctx.lineWidth = 1 / dpr;
      ctx.beginPath();
      for (let c = 0; c <= cols; c++) {
        const x = Math.round(c * cw * dpr) / dpr + 0.5 / dpr;
        ctx.moveTo(x, 0);
        ctx.lineTo(x, H);
      }
      for (let r = 0; r <= rows; r++) {
        const y = Math.round(r * ch * dpr) / dpr + 0.5 / dpr;
        ctx.moveTo(0, y);
        ctx.lineTo(W, y);
      }
      ctx.stroke();
    }

    for (const sw of this.swimmers) {
      this.swimmer = sw;
      this.renderSwimmer(cw, ch, cols, rows, bg, op);
    }

    if (opts.debug) {
      const a = this.area();
      ctx.strokeStyle = "rgba(0,120,255,.35)";
      ctx.lineWidth = 1;
      ctx.strokeRect(a.x0, a.y0, a.x1 - a.x0, a.y1 - a.y0);
      ctx.fillStyle = "rgba(0,0,0,.5)";
      ctx.font = "11px ui-monospace, monospace";
      ctx.textAlign = "left";
      ctx.fillText(`${this.frameMs.toFixed(1)} ms/frame`, 8, H - 10);
    }
  }

  private renderSwimmer(cw: number, ch: number, cols: number, rows: number, bg: RGB, op: number) {
    const { ctx, opts } = this;
    const def = this.def;
    const L = this.L;
    const seed = this.swimmer.seed * 13;
    this.buildSpine();
    this.updateDorsal();
    const fins = this.finPoses();
    const tail = this.tailPose();

    // Bounding box of everything.
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const grow = (x: number, y: number, r: number) => {
      minX = Math.min(minX, x - r); maxX = Math.max(maxX, x + r);
      minY = Math.min(minY, y - r); maxY = Math.max(maxY, y + r);
    };
    for (let k = 0; k < NODES; k++) grow(this.spine[k * 2], this.spine[k * 2 + 1], L * 0.26);
    for (const f of fins) grow(f.ax + f.dx * f.len * 0.5, f.ay + f.dy * f.len * 0.5, f.len * 0.8);
    grow(tail.x + tail.dx * tail.len * 0.5, tail.y + tail.dy * tail.len * 0.5, Math.max(tail.len, def.tail.span * def.tail.len * L) * 1.1);
    const c0 = Math.max(0, Math.floor(minX / cw));
    const c1 = Math.min(cols - 1, Math.floor(maxX / cw));
    const r0 = Math.max(0, Math.floor(minY / ch));
    const r1 = Math.min(rows - 1, Math.floor(maxY / ch));

    ctx.font = `600 ${Math.round(ch * 0.72)}px "Geist Mono", ui-monospace, Menlo, monospace`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    // Eyes and marks: one cell each.
    const special = new Map<number, string>();
    const place = (s: number, across: number, glyph: string, sides: number[]) => {
      const p = this.at(s);
      const w = def.width(s) * L * across;
      for (const sd of sides) {
        const x = p.x - p.ty * sd * w;
        const y = p.y + p.tx * sd * w;
        special.set(Math.floor(y / ch) * cols + Math.floor(x / cw), glyph);
      }
    };
    if (def.view === "side") {
      // One eye on the flank, a little toward the back.
      const p = this.at(def.eyes.s);
      const sd = this.swimmer.dorsal;
      // The near eye rolls down out of sight; past halfway the far eye comes up.
      const ph = this.rollAngle();
      const e = ph < Math.PI / 2 ? Math.sin(def.eyes.across - ph) : Math.sin(Math.PI - ph - def.eyes.across);
      const off = this.half(def.eyes.s, sd) * e;
      special.set(Math.floor((p.y + p.tx * sd * off) / ch) * cols + Math.floor((p.x - p.ty * sd * off) / cw), def.eyes.glyph);
    } else place(def.eyes.s, def.eyes.across, def.eyes.glyph, [1, -1]);
    for (const m of def.marks ?? []) place(m.s, m.across, m.glyph, [1]);

    const total = this.arc[NODES - 1] || 1;
    const roll = this.swimmer.roll;
    // A rolled body looks narrower from above.
    const narrow = 1 - 0.18 * Math.abs(roll) * (def.bank ? 1 : 0);
    const finRGB = mix(bg, def.fin, op);
    const diag = Math.hypot(cw, ch);

    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const x0 = c * cw;
        const y0 = r * ch;
        const cx = x0 + cw / 2;
        const cy = y0 + ch / 2;
        const pr = this.project(cx, cy);
        const w = this.half(pr.s, pr.side) * narrow;
        const dEdge = pr.a - w;

        // Body coverage: solid inside, empty well outside, supersampled near the outline.
        let bodyCov = 0;
        if (pr.s >= 1 && pr.a > w) bodyCov = 0;
        else if (dEdge < -diag * 0.6) bodyCov = 1;
        else if (dEdge < diag * 0.6) {
          let hits = 0;
          for (let j = 0; j < SUB; j++) {
            for (let i = 0; i < SUB; i++) {
              const q = this.project(x0 + ((i + 0.5) / SUB) * cw, y0 + ((j + 0.5) / SUB) * ch, pr.k);
              if (q.a <= this.half(q.s, q.side) * narrow && !(q.s >= 0.999 && q.a > 0)) hits++;
            }
          }
          bodyCov = hits / (SUB * SUB);
        }

        // Fin + tail coverage (drawn under the body).
        let finCov = 0;
        let finAlpha = 0;
        let rayX = 0;
        let rayY = 0;
        if (bodyCov < 1) {
          const cand: (FinPose | null)[] = [];
          for (const f of fins) {
            if (Math.hypot(cx - f.ax, cy - f.ay) < f.len + diag) cand.push(f);
          }
          const tailNear = Math.hypot(cx - tail.x, cy - tail.y) < Math.max(tail.len, def.tail.span * def.tail.len * L) * 1.2 + diag;
          if (cand.length || tailNear) {
            let hits = 0;
            for (let j = 0; j < SUB; j++) {
              for (let i = 0; i < SUB; i++) {
                const sx = x0 + ((i + 0.5) / SUB) * cw;
                const sy = y0 + ((j + 0.5) / SUB) * ch;
                let hit = false;
                for (const f of cand) {
                  if (f && this.hitFin(f, sx, sy)) {
                    hit = true;
                    finAlpha = Math.max(finAlpha, f.fin.alpha);
                    rayX = f.dx; rayY = f.dy;
                    break;
                  }
                }
                if (!hit && tailNear && this.hitTail(tail, sx, sy)) {
                  hit = true;
                  finAlpha = Math.max(finAlpha, def.tail.alpha);
                  // Tail rays fan out from the stalk.
                  rayX = sx - tail.x; rayY = sy - tail.y;
                }
                if (hit) hits++;
              }
            }
            finCov = hits / (SUB * SUB);
          }
        }

        if (finCov > 0.02) {
          const a = finCov * finAlpha;
          ctx.fillStyle = rgba(finRGB, a * 0.9);
          ctx.fillRect(x0 + 1, y0 + 1, cw - 1, ch - 1);
          if (finCov > 0.3) {
            ctx.fillStyle = rgba(mix(bg, mul(def.fin, 0.62), op), a);
            ctx.fillText(rayGlyph(rayX, rayY, cw, ch), cx, cy + 1);
          }
        }

        if (bodyCov <= 0.02) continue;
        const across = clamp(pr.a / (w || 1), 0, 1);
        const p = this.at(pr.s);
        const nx = -p.ty * pr.side;
        const ny = p.tx * pr.side;
        // Rounded back lit from the top-left; flanks fall into shadow.
        const facing = (nx * -0.6 + ny * -0.8) * across;
        let shade = 0.62 - across * across * 0.38 + facing * 0.22;
        const rg = def.ridge;
        // The dorsal fin leans toward the inside of a turn as the body rolls.
        const acrossSigned = across * pr.side - roll * 0.35;
        if (rg && pr.s > rg.s0 && pr.s < rg.s1 && Math.abs(acrossSigned) < rg.width) {
          shade += rg.shade * Math.sin(Math.PI * (pr.s - rg.s0) / (rg.s1 - rg.s0));
        }
        shade = clamp(shade, 0, 1);
        const u = pr.s;
        const v = (pr.a * pr.side) / L;
        let skinSide = def.view === "side" ? pr.side * this.swimmer.dorsal : pr.side;
        let skinAcross = across;
        if (def.view === "side" && this.swimmer.flip > 0) {
          // Point on a round cross-section at height y; the back's direction turns by φ.
          const y = clamp(across * skinSide, -1, 1);
          const yr = Math.cos(Math.asin(y) - (Math.PI / 2 - this.rollAngle()));
          skinSide = yr >= 0 ? 1 : -1;
          skinAcross = Math.abs(yr);
        }
        const base = def.skin(pr.s, skinAcross, skinSide, u, v, seed, roll);
        const block = mix(bg, mul(base, 0.74 + 0.42 * shade), op);
        const key = (hash3(Math.round((u * total) / cw), Math.round((pr.a * pr.side) / ch), seed) * 1e6) | 0;

        ctx.fillStyle = rgba(block, bodyCov);
        ctx.fillRect(x0 + 1, y0 + 1, cw - 1, ch - 1);

        const idx = r * cols + c;
        let glyph: string;
        let ink: RGB;
        if (special.has(idx)) {
          glyph = special.get(idx)!;
          ink = mix(bg, [24, 24, 28], op);
        } else if (bodyCov < 0.85) {
          glyph = EDGE_GLYPHS[key % EDGE_GLYPHS.length];
          ink = mix(bg, mul(base, 0.6), op);
        } else {
          const jitter = (key % 3) - 1;
          glyph = SKIN_RAMP[clamp(Math.floor((1 - shade) * 8.99) + jitter, 0, SKIN_RAMP.length - 1)];
          ink = key % 1000 < def.accentRate * 1000 ? mix(bg, def.accent, op) : mix(bg, mul(base, 0.5), op);
        }
        ctx.fillStyle = rgba(ink, Math.min(1, bodyCov * 1.15));
        ctx.fillText(glyph, cx, cy + 1);
      }
    }

    if (opts.debug) {
      ctx.strokeStyle = "rgba(255,0,80,.6)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let k = 0; k < NODES; k++) {
        const x = this.spine[k * 2], y = this.spine[k * 2 + 1];
        if (k === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  }
}

export type { Vec };
