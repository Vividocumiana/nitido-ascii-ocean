import { CREATURES, CreatureScene, KOI_PATCH, type CreatureOptions } from "./src/creatures";
import { cloneConfig, DEFAULT_CONFIG, hexRgb, type OceanConfig } from "./src/config";
import { OceanEngine } from "./src/engine";
import type { SharkSpec } from "./src/world";

// ── config ───────────────────────────────────────────────────────────

type Plan = "base" | "studio" | "plus";

interface PlanConfig {
  creature: string;
  count: number;
  cell: number;
  background: string;
  size: number;
  opacity: number;
  speed: number;
}

interface Config {
  plans: Record<Plan, PlanConfig>;
  grid: boolean;
  koiPatch: string;
}

const DEFAULTS: Config = {
  plans: {
    base: { creature: "goldfish", count: 3, cell: 10, background: "#f3f3f2", size: 0.95, opacity: 0.82, speed: 1 },
    studio: { creature: "koi", count: 2, cell: 10, background: "#f3f3f2", size: 1.2, opacity: 0.82, speed: 1 },
    plus: { creature: "dolphin", count: 2, cell: 10, background: "#f3f3f2", size: 0.8, opacity: 0.82, speed: 1 },
  },
  grid: true,
  koiPatch: "#DF4125",
};

const PLANS: Plan[] = ["base", "studio", "plus"];
const PLAN_NAMES: Record<Plan, string> = { base: "Base", studio: "Studio", plus: "Plus" };
const COPY: Record<Plan, { title: string; text: string; btn: string }> = {
  base: { title: "<b>Base plan</b> is active for this site.", text: 'Limited access to Nitido Studio. <a href="#">Upgrade to Studio</a> to unlock more.', btn: "Upgrade to Studio" },
  studio: { title: "<b>Studio plan</b> is active for this site.", text: 'More pages, more sections. <a href="#">Upgrade to Plus</a> to unlock everything.', btn: "Upgrade to Plus" },
  plus: { title: "<b>Plus plan</b> is active for this site.", text: "Every feature of Nitido Studio, no limits.", btn: "Manage plan" },
};
const SWATCHES = ["#f3f3f2", "#ffffff", "#efe9df", "#e9eef3", "#121212"];

// Ready-made looks for the gallery; each applies to the selected plan.
const LOOKS: { name: string; look: PlanConfig }[] = [
  { name: "Paper Goldfish", look: { creature: "goldfish", count: 3, cell: 10, background: "#f3f3f2", size: 0.95, opacity: 0.82, speed: 1 } },
  { name: "Koi Pond", look: { creature: "koi", count: 2, cell: 10, background: "#f3f3f2", size: 1.2, opacity: 0.82, speed: 1 } },
  { name: "Dolphin Play", look: { creature: "dolphin", count: 2, cell: 10, background: "#f3f3f2", size: 0.8, opacity: 0.82, speed: 1 } },
  { name: "Night Koi", look: { creature: "koi", count: 3, cell: 9, background: "#0e1a26", size: 1.0, opacity: 0.92, speed: 0.9 } },
  { name: "Sand School", look: { creature: "goldfish", count: 6, cell: 8, background: "#efe9df", size: 0.7, opacity: 0.85, speed: 1 } },
  { name: "Deep Pod", look: { creature: "dolphin", count: 3, cell: 8, background: "#0e1a26", size: 0.7, opacity: 0.95, speed: 1.1 } },
  { name: "Solo Koi", look: { creature: "koi", count: 1, cell: 12, background: "#ffffff", size: 1.5, opacity: 0.8, speed: 0.8 } },
  { name: "Mist Dolphin", look: { creature: "dolphin", count: 1, cell: 12, background: "#e9eef3", size: 1.1, opacity: 0.75, speed: 0.9 } },
  { name: "Fine Koi", look: { creature: "koi", count: 2, cell: 6, background: "#efe9df", size: 1.1, opacity: 0.85, speed: 1 } },
  { name: "Shark Patrol", look: { creature: "shark", count: 2, cell: 7, background: "#f3f3f2", size: 1.1, opacity: 0.85, speed: 1 } },
  { name: "Night Shark", look: { creature: "shark", count: 1, cell: 6, background: "#121212", size: 1.3, opacity: 0.95, speed: 0.9 } },
  { name: "Goldfish Swarm", look: { creature: "goldfish", count: 7, cell: 7, background: "#ffffff", size: 0.6, opacity: 0.8, speed: 1.2 } },
];

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

// Everything selectable: our creatures, plus the original shark from the ocean engine.
const NAMES: Record<string, string> = {
  ...Object.fromEntries(Object.entries(CREATURES).map(([k, d]) => [k, d.name])),
  shark: "Shark",
};

// ── the original shark (rendered by the ocean engine) ────────────────

const sharkSpecs = (n: number, size: number): SharkSpec[] =>
  Array.from({ length: n }, (_, i) => ({ kind: "classic", size: size * [1, 0.84, 0.92, 0.77, 0.88, 0.8, 0.95][i % 7] }));

/** Map a plan's settings onto an ocean-engine config. */
function sharkConfig(c: PlanConfig, grid: boolean, cfg: OceanConfig = cloneConfig(DEFAULT_CONFIG)) {
  const dark = isDark(c.background);
  Object.assign(cfg.scene, { background: c.background, grid, gridAlpha: 0.045, cellSize: c.cell, wake: false, eatFlash: false, centerFade: 0 });
  Object.assign(cfg.predators, { list: sharkSpecs(c.count, c.size), avoidCenter: false, hunger: 1, speed: 1, opacity: c.opacity, tone: 1, accents: 1, accentColor: "" });
  Object.assign(cfg.prey, { color: dark ? "#cfd8e6" : "#6f737b" });
  Object.assign(cfg.pointer, { splash: false });
  cfg.timeScale = c.speed;
  return cfg;
}
const SHARK_PREY = 18;
const isDark = (hex: string) => {
  const [r, g, b] = hexRgb(hex);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 < 0.45;
};

/** Config lives in the URL hash, so a link reproduces the exact setup. */
function load(): Config {
  try {
    if (location.hash.length > 1) {
      const saved = JSON.parse(decodeURIComponent(atob(location.hash.slice(1))));
      const cfg = clone(DEFAULTS);
      for (const p of PLANS) {
        Object.assign(cfg.plans[p], saved.plans?.[p]);
        // Links made before the sharks were merged into one.
        if (!(cfg.plans[p].creature in NAMES)) cfg.plans[p].creature = "shark";
      }
      if (typeof saved.grid === "boolean") cfg.grid = saved.grid;
      if (saved.koiPatch) cfg.koiPatch = saved.koiPatch;
      return cfg;
    }
  } catch {
    // Bad or old link: fall back to defaults.
  }
  return clone(DEFAULTS);
}

const config = load();
KOI_PATCH.color = config.koiPatch;
let plan: Plan = "base";
let paused = false;

const linkFor = () => location.origin + location.pathname + "#" + btoa(encodeURIComponent(JSON.stringify(config)));

// Undo/redo: snapshots of the whole config, taken when a change is committed.
const history: string[] = [JSON.stringify(config)];
let cursor = 0;
function commit() {
  const snap = JSON.stringify(config);
  if (snap === history[cursor]) return;
  history.splice(cursor + 1);
  history.push(snap);
  cursor = history.length - 1;
  window.history.replaceState(null, "", "#" + btoa(encodeURIComponent(snap)));
  syncToolbar();
}
function restore(snap: string) {
  const c = JSON.parse(snap) as Config;
  Object.assign(config, c);
  KOI_PATCH.color = config.koiPatch;
  showPlan(true);
  window.history.replaceState(null, "", "#" + btoa(encodeURIComponent(snap)));
}

// ── icons ────────────────────────────────────────────────────────────

const svg = (d: string) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="${d}"/></svg>`;
const ICON = {
  creature: svg("M3 12c3.5-5 10-6.5 15 0-5 6.5-11.5 5-15 0Z M18 12l3-3v6l-3-3 M8 11h.01"),
  count: svg("M7 7h.01M12 7h.01M17 7h.01M7 12h.01M12 12h.01M17 12h.01M7 17h.01M12 17h.01"),
  cell: svg("M4 4h16v16H4z M4 10h16 M4 15h16 M10 4v16 M15 4v16"),
  size: svg("M15 3h6v6 M9 21H3v-6 M21 3l-7 7 M3 21l7-7"),
  opacity: svg("M12 3l5.5 5.8a7.5 7.5 0 1 1-11 0Z"),
  speed: svg("M12 14l4-4 M3.5 18.5a9.5 9.5 0 1 1 17 0"),
  background: svg("M4 4h16v16H4z M4 15l5-5 4 4 3-3 4 4"),
  grid: svg("M4 4h16v16H4z M4 12h16 M12 4v16"),
  patch: svg("M12 21a9 9 0 1 1 0-18 9 9 0 0 1 0 18Z M9 10a1.5 1.5 0 1 0 0-.01 M15 14a2 2 0 1 0 0-.01"),
  all: svg("M8 8h11v11H8z M5 16V5h11"),
  bookmark: svg("M18 21l-6-4-6 4V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2z"),
  undo: svg("M9 14L4 9l5-5 M4 9h10.5a5.5 5.5 0 0 1 0 11H11"),
  redo: svg("M15 14l5-5-5-5 M20 9H9.5a5.5 5.5 0 0 0 0 11H13"),
  play: svg("M7 4l13 8-13 8z"),
  pause: svg("M7 4h3v16H7z M14 4h3v16h-3z"),
};

const h = (html: string) => {
  const t = document.createElement("template");
  t.innerHTML = html.trim();
  return t.content.firstElementChild as HTMLElement;
};

// ── the ocean behind everything: all three creatures at once ──────────

const OCEAN = "#121212";
const oceanEl = document.getElementById("ocean")!;

// Bottom layer: the original ocean — schools of tiny fish that flock and flee, and the
// original sharks hunting them.
const baseCfg = cloneConfig(DEFAULT_CONFIG);
Object.assign(baseCfg.scene, { background: OCEAN, grid: true, gridAlpha: 0.035, wakeColor: "#5fb8cc", wakeDecay: 1.2, cellSize: 5 });
Object.assign(baseCfg.predators, { list: sharkSpecs(3, 0.6), avoidCenter: false, hunger: 0.8, speed: 0.9, opacity: 0.75, tone: 1, accents: 0.7 });
Object.assign(baseCfg.prey, { color: "#cfd8e6" });
Object.assign(baseCfg.pointer, { repel: true, radius: 110, splash: false });
const base = document.createElement("canvas");
base.style.fontFamily = '"Geist Mono", ui-monospace, monospace';
oceanEl.append(base);
new OceanEngine(base, baseCfg.predators.list, { config: baseCfg });

// Above it: our creatures, each group circling the window at its own pace, in the margins.
const oceanLayers: { creature: string; count: number; size: number; seed: number; ring: { rx: number; ry: number; speed: number; phase: number } }[] = [
  { creature: "dolphin", count: 3, size: 0.17, seed: 21, ring: { rx: 0.46, ry: 0.45, speed: 1, phase: 0 } },
  { creature: "koi", count: 3, size: 0.18, seed: 22, ring: { rx: 0.47, ry: 0.46, speed: -1, phase: 2.2 } },
  { creature: "goldfish", count: 7, size: 0.13, seed: 23, ring: { rx: 0.46, ry: 0.45, speed: 0.8, phase: 4.1 } },
  { creature: "dolphin", count: 2, size: 0.15, seed: 24, ring: { rx: 0.48, ry: 0.47, speed: -0.9, phase: 5.3 } },
  { creature: "koi", count: 2, size: 0.15, seed: 28, ring: { rx: 0.46, ry: 0.47, speed: 0.9, phase: 2.8 } },
  { creature: "goldfish", count: 5, size: 0.11, seed: 29, ring: { rx: 0.47, ry: 0.46, speed: -0.8, phase: 0.2 } },
];
const oceanScenes: CreatureScene[] = [];
oceanLayers.forEach((l, i) => {
  const canvas = document.createElement("canvas");
  oceanEl.append(canvas);
  oceanScenes[i] = new CreatureScene(canvas, {
    creature: l.creature, count: l.count, size: l.size, cell: 5, background: OCEAN, opacity: 0.8, speed: 1,
    grid: false, debug: false, transparent: true, ring: l.ring,
    area: { x0: 0.02, y0: 0.03, x1: 0.98, y1: 0.97 },
  }, l.seed);
});

// ── preview card ─────────────────────────────────────────────────────

const card = document.getElementById("card")!;
const sceneOpts = (c: PlanConfig): CreatureOptions => ({
  // The shark has its own engine; keep this scene on something valid meanwhile.
  creature: c.creature in CREATURES ? c.creature : "goldfish", count: c.count, size: c.size, cell: c.cell, background: c.background,
  opacity: c.opacity, speed: paused ? 0 : c.speed, grid: config.grid, debug: false,
  area: { x0: 0.68, y0: 0.18, x1: 0.95, y1: 0.82 }, wall: 0.56,
});
const creatureCanvas = card.querySelector("canvas")!;
const scene = new CreatureScene(creatureCanvas, sceneOpts(config.plans[plan]), 3);
// The shark plan draws with the original engine, on its own canvas.
const sharkCanvas = document.createElement("canvas");
sharkCanvas.setAttribute("aria-hidden", "true");
sharkCanvas.style.fontFamily = '"Geist Mono", ui-monospace, monospace';
creatureCanvas.after(sharkCanvas);
const sharkCfg = cloneConfig(DEFAULT_CONFIG);
let sharkEngine: OceanEngine | null = null;
let leftPx = 0;

/** Keep every body right of the copy: measure where the text ends. */
function layoutArea() {
  const r = card.getBoundingClientRect();
  const copy = card.querySelector<HTMLElement>(".copy")!.getBoundingClientRect();
  if (r.width < 1) return;
  const wall = Math.min(0.85, (copy.right - r.left + 8) / r.width);
  scene.opts.wall = wall;
  scene.opts.area = { x0: Math.min(0.9, wall + 0.14), y0: 0.18, x1: 0.95, y1: 0.82 };
  leftPx = wall * r.width + 36;
  if (sharkEngine) sharkEngine.world.left = leftPx;
}
new ResizeObserver(layoutArea).observe(card);

/** Push the selected plan into the preview. `restart` rebuilds the school. */
function applyPreview(restart = false) {
  const c = config.plans[plan];
  const isShark = c.creature === "shark";
  creatureCanvas.style.display = isShark ? "none" : "";
  sharkCanvas.style.display = isShark ? "" : "none";
  layoutArea();
  card.style.background = c.background;
  card.classList.toggle("dark", isDark(c.background));
  if (isShark) {
    sharkConfig({ ...c, speed: paused ? 0 : c.speed }, config.grid, sharkCfg);
    if (!sharkEngine) {
      sharkEngine = new OceanEngine(sharkCanvas, sharkCfg.predators.list, { config: sharkCfg, fishCount: SHARK_PREY });
      restart = true;
    }
    sharkEngine.world.left = leftPx;
    if (restart) sharkEngine.world.reseed(sharkCfg.predators.list, SHARK_PREY);
  } else {
    Object.assign(scene.opts, sceneOpts(c));
    if (restart) scene.restart();
  }
  document.getElementById("name")!.textContent = `${PLAN_NAMES[plan]} · ${NAMES[c.creature]} ×${c.count}`;
}

function showPlan(restart = false) {
  document.getElementById("cardTitle")!.innerHTML = COPY[plan].title;
  document.getElementById("cardText")!.innerHTML = COPY[plan].text;
  document.getElementById("cardBtn")!.textContent = COPY[plan].btn;
  planSeg.querySelectorAll<HTMLButtonElement>("button").forEach((b) => b.classList.toggle("on", b.dataset.plan === plan));
  buildControls();
  applyPreview(restart);
  syncToolbar();
}

// ── controls ─────────────────────────────────────────────────────────

const planSeg = document.getElementById("plans")!;
for (const p of PLANS) {
  const b = h(`<button data-plan="${p}">${PLAN_NAMES[p]}</button>`);
  b.onclick = () => {
    plan = p;
    showPlan(true);
  };
  planSeg.append(b);
}

const controls = document.getElementById("controls")!;

function pill(icon: string, label: string, ctl: HTMLElement) {
  const el = h(`<div class="pill"><span class="ic">${icon}</span><span class="lb">${label}</span><span class="ctl"></span></div>`);
  el.querySelector(".ctl")!.append(ctl);
  return el;
}

function rangePill(icon: string, label: string, key: keyof PlanConfig, min: number, max: number, step: number, restart = false, fmt = (v: number) => String(v)) {
  const c = config.plans[plan];
  const wrap = h(`<span style="display:flex;align-items:center;gap:8px"><input type="range" min="${min}" max="${max}" step="${step}" value="${c[key]}"><span class="val">${fmt(c[key] as number)}</span></span>`);
  const input = wrap.querySelector("input")!;
  input.oninput = () => {
    (c[key] as number) = Number(input.value);
    wrap.querySelector(".val")!.textContent = fmt(Number(input.value));
    if (!restart) applyPreview();
  };
  // Rebuilding the school on every tick would stutter; do it when the slider is let go.
  input.onchange = () => {
    applyPreview(restart);
    commit();
  };
  return pill(icon, label, wrap);
}

function buildControls() {
  const c = config.plans[plan];
  controls.innerHTML = "";

  // Creature: three chips.
  const chips = h(`<span style="display:flex;gap:4px">${Object.entries(NAMES)
    .map(([k, name]) => `<button class="chip" data-k="${k}" style="${k === c.creature ? "background:#141414;color:#fff;border-color:#141414" : ""}">${name}</button>`).join("")}</span>`);
  chips.querySelectorAll<HTMLButtonElement>("button").forEach((b) => (b.onclick = () => {
    c.creature = b.dataset.k!;
    applyPreview(true);
    buildControls();
    commit();
  }));
  controls.append(h(`<div class="pill" style="grid-template-columns:22px 1fr"><span class="ic">${ICON.creature}</span><span class="lb">Creature</span></div>`), chips);
  chips.style.cssText += ";padding:0 4px 4px;flex-wrap:wrap;gap:5px";

  // Count: stepper.
  const step = h(`<span style="display:flex;align-items:center;gap:6px"><button class="chip">−</button><span class="val" style="min-width:16px;text-align:center">${c.count}</span><button class="chip">+</button></span>`);
  const [minus, plus] = Array.from(step.querySelectorAll("button"));
  const setCount = (n: number) => {
    c.count = Math.max(1, Math.min(7, n));
    step.querySelector(".val")!.textContent = String(c.count);
    applyPreview(true);
    commit();
  };
  minus.onclick = () => setCount(c.count - 1);
  plus.onclick = () => setCount(c.count + 1);
  controls.append(pill(ICON.count, "Count", step));

  controls.append(
    rangePill(ICON.cell, "Cell", "cell", 5, 18, 1),
    rangePill(ICON.size, "Size", "size", 0.4, 1.6, 0.05, true, (v) => v.toFixed(2)),
    rangePill(ICON.opacity, "Opacity", "opacity", 0.2, 1, 0.02, false, (v) => v.toFixed(2)),
    rangePill(ICON.speed, "Speed", "speed", 0, 2.5, 0.05, false, (v) => v.toFixed(2)),
  );

  // Background: swatches + custom.
  const sw = h(`<span class="swatches">${SWATCHES.map((s) => `<button style="background:${s}" data-c="${s}" class="${s === c.background ? "on" : ""}" title="${s}"></button>`).join("")}<label title="Custom">+<input type="color" value="${c.background}"></label></span>`);
  const setBg = (v: string) => {
    c.background = v;
    sw.querySelectorAll<HTMLButtonElement>("button").forEach((b) => b.classList.toggle("on", b.dataset.c === v));
    applyPreview();
  };
  sw.querySelectorAll<HTMLButtonElement>("button").forEach((b) => (b.onclick = () => { setBg(b.dataset.c!); commit(); }));
  const custom = sw.querySelector("input")!;
  custom.oninput = () => setBg(custom.value);
  custom.onchange = () => commit();
  controls.append(pill(ICON.background, "Color", sw));

  // Grid toggle (all plans).
  const tg = h(`<button class="toggle ${config.grid ? "on" : ""}" aria-label="Grid"></button>`);
  tg.onclick = () => {
    config.grid = !config.grid;
    tg.classList.toggle("on", config.grid);
    applyPreview();
    commit();
  };
  controls.append(pill(ICON.grid, "Grid", tg));

  // Koi patch colour (shared).
  const box = h(`<span class="colorbox" style="background:${config.koiPatch}"><input type="color" value="${config.koiPatch}"></span>`);
  const boxIn = box.querySelector("input")!;
  boxIn.oninput = () => {
    config.koiPatch = KOI_PATCH.color = boxIn.value;
    box.style.background = boxIn.value;
  };
  boxIn.onchange = () => commit();
  controls.append(pill(ICON.patch, "Koi patches", box));

  // Copy the look to the other plans.
  const allBtn = h(`<button class="chip">Apply</button>`);
  allBtn.onclick = () => {
    for (const p of PLANS) {
      if (p !== plan) Object.assign(config.plans[p], { cell: c.cell, background: c.background, opacity: c.opacity, speed: c.speed });
    }
    commit();
    toast("Cell, background, opacity and speed applied to all plans");
  };
  controls.append(pill(ICON.all, "Look → all plans", allBtn));
}

// ── toolbar ──────────────────────────────────────────────────────────

const $ = (id: string) => document.getElementById(id)!;
$("fav").innerHTML = ICON.bookmark;
$("gridBtn").innerHTML = ICON.grid;
$("undo").innerHTML = ICON.undo;
$("redo").innerHTML = ICON.redo;

function syncToolbar() {
  ($("undo") as HTMLButtonElement).disabled = cursor <= 0;
  ($("redo") as HTMLButtonElement).disabled = cursor >= history.length - 1;
  $("play").innerHTML = paused ? ICON.play : ICON.pause;
}

$("undo").onclick = () => { if (cursor > 0) restore(history[--cursor]); };
$("redo").onclick = () => { if (cursor < history.length - 1) restore(history[++cursor]); };
$("play").onclick = () => {
  paused = !paused;
  applyPreview();
  syncToolbar();
};
$("gridBtn").onclick = () => {
  config.grid = !config.grid;
  buildControls();
  applyPreview();
  commit();
};
$("fav").onclick = () => {
  const c = clone(config.plans[plan]);
  favorites.unshift({ name: `${NAMES[c.creature]} ×${c.count}`, look: c });
  saveFavs();
  toast("Saved to favorites");
  if (tab === "favs") buildLooks();
};

const menu = $("menu");
$("export").onclick = (e) => {
  e.stopPropagation();
  menu.classList.toggle("open");
};
document.addEventListener("click", () => menu.classList.remove("open"));
menu.querySelectorAll<HTMLButtonElement>("button").forEach((b) => (b.onclick = () => {
  const act = b.dataset.act;
  if (act === "link") navigator.clipboard.writeText(linkFor()).then(() => toast("Link copied"));
  if (act === "json") navigator.clipboard.writeText(JSON.stringify(config, null, 2)).then(() => toast("JSON copied"));
  if (act === "reset") {
    Object.assign(config, clone(DEFAULTS));
    KOI_PATCH.color = config.koiPatch;
    showPlan(true);
    commit();
    toast("Reset");
  }
}));

// ── looks gallery ────────────────────────────────────────────────────

let favorites: { name: string; look: PlanConfig }[] = [];
try {
  favorites = JSON.parse(localStorage.getItem("plan-creature-favs") || "[]");
  for (const f of favorites) if (!(f.look.creature in NAMES)) f.look.creature = "shark";
} catch {
  favorites = [];
}
function saveFavs() {
  try {
    localStorage.setItem("plan-creature-favs", JSON.stringify(favorites.slice(0, 24)));
  } catch {
    // Storage unavailable (private window): favorites last for this visit only.
  }
}

let tab: "looks" | "favs" = "looks";
let tileScenes: { destroy(): void }[] = [];
const looksEl = $("looks");

function buildLooks() {
  tileScenes.forEach((s) => s.destroy());
  tileScenes = [];
  looksEl.innerHTML = "";
  const items = tab === "looks" ? LOOKS : favorites;
  if (!items.length) {
    looksEl.append(h(`<div class="empty">No favorites yet.<br>Save a look with the bookmark in the toolbar.</div>`));
    return;
  }
  items.forEach((item, i) => {
    const tile = h(`<button class="tile" title="${item.name}"><canvas></canvas><span>${item.name}</span></button>`);
    tile.style.background = item.look.background;
    looksEl.append(tile);
    const l = item.look;
    const tc = tile.querySelector("canvas")!;
    if (l.creature === "shark") {
      tc.style.fontFamily = '"Geist Mono", ui-monospace, monospace';
      const cfg = sharkConfig({ ...l, cell: Math.max(4, Math.round(l.cell * 0.6)), size: l.size * 0.8, count: Math.min(l.count, 3) }, false);
      tileScenes.push(new OceanEngine(tc, cfg.predators.list, { config: cfg, fishCount: 8 }));
    } else tileScenes.push(new CreatureScene(tc, {
      creature: l.creature, count: Math.min(l.count, 4), size: l.size * 0.7, cell: Math.max(4, Math.round(l.cell * 0.5)),
      background: l.background, opacity: l.opacity, speed: l.speed, grid: false, debug: false,
      area: { x0: 0.2, y0: 0.2, x1: 0.8, y1: 0.8 },
    }, 50 + i));
    tile.onclick = () => {
      Object.assign(config.plans[plan], clone(l));
      looksEl.querySelectorAll(".tile").forEach((t) => t.classList.remove("on"));
      tile.classList.add("on");
      showPlan(true);
      commit();
    };
  });
}

$("lookTabs").querySelectorAll<HTMLButtonElement>("button").forEach((b) => (b.onclick = () => {
  tab = b.dataset.tab as typeof tab;
  $("lookTabs").querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b));
  buildLooks();
}));

function toast(msg: string) {
  const t = $("toast");
  t.textContent = msg;
  t.classList.add("on");
  setTimeout(() => t.classList.remove("on"), 1500);
}

showPlan(true);
buildLooks();

(window as unknown as Record<string, unknown>).__ocean = oceanScenes;
