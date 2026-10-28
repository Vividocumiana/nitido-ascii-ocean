import { applyConfig, config, DEFAULT_CONFIG, OceanEngine, SPECIES, type OceanConfig, type SharkKind } from "./src";

const KINDS: SharkKind[] = ["koi", "classic", "hammerhead", "greathammer", "tiger", "zebra", "mako", "thresher", "nurse"];

// Ready-made looks. Each is a partial config layered on the defaults.
const PRESETS: Record<string, Partial<OceanConfig>> = {
  "Hero": {},
  "Bait ball": {
    prey: { ...DEFAULT_CONFIG.prey, count: 260, mill: 3, cohesion: 1.8, weights: { sardine: 1, anchovy: 0, silverside: 0, mackerel: 0, goby: 0 } },
    predators: { ...DEFAULT_CONFIG.predators, list: [{ kind: "mako", size: 1 }, { kind: "mako", size: 0.8 }], hunger: 2.5 },
  },
  "Feeding frenzy": {
    timeScale: 1.3,
    prey: { ...DEFAULT_CONFIG.prey, speed: 1.3, jitter: 1.5 },
    predators: { ...DEFAULT_CONFIG.predators, list: KINDS.slice(0, 6).map((kind, i) => ({ kind, size: 1 - i * 0.08 })), hunger: 4, speed: 1.3, agility: 1.4, avoidCenter: false },
    scene: { ...DEFAULT_CONFIG.scene, wakeColor: "#ff6a3d" },
  },
  "Calm aquarium": {
    timeScale: 0.6,
    current: 0.4,
    prey: { ...DEFAULT_CONFIG.prey, jitter: 0.5, glyph: "~" },
    predators: { ...DEFAULT_CONFIG.predators, list: [{ kind: "nurse", size: 1 }], hunger: 0 },
    scene: { ...DEFAULT_CONFIG.scene, background: "#020814", wakeColor: "#4f7cff", wakeDecay: 0.8 },
  },
  "Hammer patrol": {
    predators: { ...DEFAULT_CONFIG.predators, list: [{ kind: "greathammer", size: 1 }, { kind: "hammerhead", size: 0.8 }, { kind: "hammerhead", size: 0.7 }] },
  },
  "Koi pond": {
    timeScale: 0.85,
    current: 0.5,
    prey: { ...DEFAULT_CONFIG.prey, count: 90, glyph: "-", color: "#7d8088", jitter: 0.6, speed: 0.7, weights: { sardine: 0, anchovy: 0, silverside: 0, mackerel: 0, goby: 1 } },
    predators: {
      ...DEFAULT_CONFIG.predators,
      list: [0.85, 0.75, 0.68, 0.6, 0.55].map((size) => ({ kind: "koi" as SharkKind, size })),
      hunger: 0, speed: 0.55, agility: 1.3, fear: 0.6,
      opacity: 0.9, tone: 1, accents: 0.5, accentColor: "#DF4125", patchColor: "#DF4125", patchAmount: 0.5,
    },
    scene: { ...DEFAULT_CONFIG.scene, background: "#f4f4f2", gridAlpha: 0.045, wakeColor: "#9fbcc4", wakeDecay: 0.9, eatFlash: false, centerFade: 0.7 },
  },
  "Fish only": {
    predators: { ...DEFAULT_CONFIG.predators, list: [] },
    prey: { ...DEFAULT_CONFIG.prey, count: 320 },
  },
};

// Colour-only looks: they change the palette and leave the creatures alone.
type Theme = { scene: Partial<OceanConfig["scene"]>; prey: { color: string }; predators: Pick<OceanConfig["predators"], "opacity" | "tone" | "accents"> };
const THEMES: Record<string, Theme> = {
  "Dark": {
    scene: { background: "#000000", gridAlpha: 0.055, wakeColor: "#6ee6ff", centerFade: 0 },
    prey: { color: "#e6eeff" },
    predators: { opacity: 1, tone: 1, accents: 1 },
  },
  "Paper": {
    scene: { background: "#f4f4f2", gridAlpha: 0.045, wakeColor: "#8fb3bf", centerFade: 0.85 },
    prey: { color: "#4a4d55" },
    predators: { opacity: 0.55, tone: 1.15, accents: 0.7 },
  },
  "Sand": {
    scene: { background: "#efe9df", gridAlpha: 0.05, wakeColor: "#c49a6c", centerFade: 0.7 },
    prey: { color: "#6b5d4d" },
    predators: { opacity: 0.5, tone: 1.2, accents: 0.5 },
  },
  "Deep navy": {
    scene: { background: "#06101f", gridAlpha: 0.05, wakeColor: "#4f7cff", centerFade: 0.5 },
    prey: { color: "#9fb4d8" },
    predators: { opacity: 0.6, tone: 1, accents: 0.6 },
  },
  "Mono": {
    scene: { background: "#0b0b0b", gridAlpha: 0.04, wakeColor: "#8a8a8a", centerFade: 0 },
    prey: { color: "#bdbdbd" },
    predators: { opacity: 0.8, tone: 1, accents: 0 },
  },
};
function applyTheme(t: Theme) {
  Object.assign(config.scene, t.scene);
  Object.assign(config.prey, t.prey);
  Object.assign(config.predators, t.predators);
}

// ── restore from URL hash ─────────────────────────────────────────────
function readHash(): Partial<OceanConfig> | null {
  try {
    return location.hash.length > 1 ? JSON.parse(decodeURIComponent(atob(location.hash.slice(1)))) : null;
  } catch {
    return null;
  }
}
const fromHash = readHash();
if (fromHash) applyConfig(fromHash);

const engine = new OceanEngine(document.querySelector("canvas")!, config.predators.list);
const reseed = () => engine.world.reseed(config.predators.list, config.prey.count || undefined);
if (config.prey.count) reseed();

let hashTimer = 0;
function persist() {
  clearTimeout(hashTimer);
  hashTimer = window.setTimeout(() => history.replaceState(null, "", "#" + btoa(encodeURIComponent(JSON.stringify(config)))), 250);
}

// ── tiny UI builder ──────────────────────────────────────────────────
const body = document.getElementById("body")!;
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, unknown> = {}, ...kids: (Node | string)[]): HTMLElementTagNameMap[K] => {
  const e = Object.assign(document.createElement(tag), props) as HTMLElementTagNameMap[K];
  e.append(...kids);
  return e;
};

function section(title: string, open = false) {
  const sec = el("div", { className: "sec" });
  const d = el("details", {}, el("summary", {}, title), sec);
  d.open = open;
  body.append(d);
  return sec;
}

type Path = [any, string];
const AUTO = new Set(["count", "cellSize"]);
function slider(parent: HTMLElement, label: string, [obj, key]: Path, min: number, max: number, step: number, opts: { reseed?: boolean } = {}) {
  const out = el("output", {}, String(obj[key]));
  const input = el("input", { type: "range", min: String(min), max: String(max), step: String(step), value: String(obj[key]) });
  input.oninput = () => {
    obj[key] = Number(input.value);
    out.textContent = obj[key] === 0 && AUTO.has(key) ? "auto" : String(obj[key]);
    if (!opts.reseed) persist();
  };
  input.onchange = () => {
    if (opts.reseed) reseed();
    persist();
  };
  if (obj[key] === 0 && AUTO.has(key)) out.textContent = "auto";
  parent.append(el("div", { className: "row" }, el("label", { title: label }, label), input, out));
}

function color(parent: HTMLElement, label: string, [obj, key]: Path) {
  const input = el("input", { type: "color", value: obj[key] });
  input.oninput = () => { obj[key] = input.value; persist(); };
  parent.append(el("div", { className: "row two" }, el("label", {}, label), input));
}

function check(parent: HTMLElement, label: string, [obj, key]: Path) {
  const input = el("input", { type: "checkbox", checked: obj[key] });
  input.onchange = () => { obj[key] = input.checked; persist(); };
  parent.append(el("div", { className: "row two" }, el("label", {}, label), input));
}

function text(parent: HTMLElement, label: string, [obj, key]: Path, maxLength = 1) {
  const input = el("input", { type: "text", value: obj[key], maxLength });
  input.oninput = () => { obj[key] = input.value; persist(); };
  parent.append(el("div", { className: "row two" }, el("label", {}, label), input));
}

function toast(msg: string) {
  const t = document.getElementById("toast")!;
  t.textContent = msg;
  t.classList.add("on");
  setTimeout(() => t.classList.remove("on"), 1400);
}

// ── build the panel (re-run after loading a preset) ──────────────────
function build() {
  body.innerHTML = "";

  const pre = section("Presets", true);
  const chips = el("div", { className: "btns" });
  for (const name of Object.keys(PRESETS)) {
    chips.append(el("button", {
      className: "chip",
      textContent: name,
      onclick: () => { applyConfig(PRESETS[name]); reseed(); persist(); build(); toast(name); },
    }));
  }
  pre.append(chips);

  const theme = section("Theme", true);
  const tchips = el("div", { className: "btns" });
  for (const name of Object.keys(THEMES)) {
    tchips.append(el("button", { className: "chip", textContent: name, onclick: () => { applyTheme(THEMES[name]); persist(); build(); toast(name); } }));
  }
  theme.append(tchips);
  slider(theme, "ASCII cell", [config.scene, "cellSize"], 0, 28, 1);
  theme.append(el("div", { className: "hint" }, "Cell 0 = auto. Smaller = more detail, bigger = chunkier."));
  slider(theme, "centre fade", [config.scene, "centerFade"], 0, 1, 0.05);

  const glob = section("Global", true);
  slider(glob, "time scale", [config, "timeScale"], 0, 3, 0.05);
  slider(glob, "current", [config, "current"], 0, 4, 0.1);

  // Predators
  const pred = section("Predators · sharks", true);
  const list = el("div", { className: "sec" });
  const renderList = () => {
    list.innerHTML = "";
    config.predators.list.forEach((spec, i) => {
      const kind = el("select");
      for (const k of KINDS) kind.append(el("option", { value: k, textContent: k, selected: k === spec.kind }));
      kind.onchange = () => { spec.kind = kind.value as SharkKind; reseed(); persist(); };
      const size = el("input", { type: "range", min: "0.3", max: "1.4", step: "0.05", value: String(spec.size), title: "size" });
      size.onchange = () => { spec.size = Number(size.value); reseed(); persist(); };
      const del = el("button", { textContent: "×", title: "remove", onclick: () => { config.predators.list.splice(i, 1); reseed(); persist(); renderList(); } });
      list.append(el("div", { className: "pred" }, kind, size, del));
    });
    if (!config.predators.list.length) list.append(el("div", { className: "hint" }, "No predators — the fish just school."));
  };
  list.style.padding = "0";
  renderList();
  pred.append(list, el("div", { className: "btns" }, el("button", {
    textContent: "+ add shark",
    onclick: () => {
      config.predators.list.push({ kind: KINDS[config.predators.list.length % KINDS.length], size: 0.8 });
      reseed(); persist(); renderList();
    },
  })));
  const P = config.predators;
  slider(pred, "speed", [P, "speed"], 0.2, 3, 0.05);
  slider(pred, "agility", [P, "agility"], 0.2, 3, 0.05);
  slider(pred, "hunger", [P, "hunger"], 0, 6, 0.1);
  slider(pred, "scare radius", [P, "fear"], 0, 3, 0.05);
  slider(pred, "opacity", [P, "opacity"], 0.1, 1, 0.05);
  slider(pred, "tone", [P, "tone"], 0.4, 1.6, 0.05);
  slider(pred, "accents", [P, "accents"], 0, 3, 0.1);
  const single = el("input", { type: "checkbox", checked: !!P.accentColor });
  const accPick = el("input", { type: "color", value: P.accentColor || "#DF4125" });
  const syncAcc = () => { P.accentColor = single.checked ? accPick.value : ""; persist(); };
  single.onchange = syncAcc;
  accPick.oninput = syncAcc;
  pred.append(el("div", { className: "row" }, el("label", {}, "one accent"), accPick, single));
  pred.append(el("div", { className: "hint" }, "Koi:"));
  color(pred, "patch colour", [P, "patchColor"]);
  slider(pred, "patch amount", [P, "patchAmount"], 0, 1, 0.05);
  check(pred, "clear centre", [P, "avoidCenter"]);

  // Prey
  const prey = section("Prey · fish", true);
  const F = config.prey;
  slider(prey, "count", [F, "count"], 0, 800, 10, { reseed: true });
  text(prey, "glyph", [F, "glyph"]);
  color(prey, "colour", [F, "color"]);
  slider(prey, "speed", [F, "speed"], 0.2, 3, 0.05);
  slider(prey, "alignment", [F, "align"], 0, 4, 0.05);
  slider(prey, "cohesion", [F, "cohesion"], 0, 4, 0.05);
  slider(prey, "jitter", [F, "jitter"], 0, 4, 0.05);
  slider(prey, "bait-ball spin", [F, "mill"], 0, 5, 0.05);
  prey.append(el("div", { className: "hint" }, "Species mix (reseeds):"));
  for (const sp of SPECIES) {
    if (F.weights[sp.name] === undefined) F.weights[sp.name] = sp.weight;
    slider(prey, sp.name, [F.weights, sp.name], 0, 6, 1, { reseed: true });
  }

  // Scene
  const scene = section("Scene");
  const S = config.scene;
  color(scene, "background", [S, "background"]);
  check(scene, "grid", [S, "grid"]);
  slider(scene, "grid alpha", [S, "gridAlpha"], 0, 0.3, 0.005);
  check(scene, "wake", [S, "wake"]);
  color(scene, "wake colour", [S, "wakeColor"]);
  slider(scene, "wake fade", [S, "wakeDecay"], 0.2, 5, 0.1);
  check(scene, "eat flash", [S, "eatFlash"]);

  // Interaction
  const inter = section("Interaction");
  check(inter, "cursor repels", [config.pointer, "repel"]);
  slider(inter, "cursor radius", [config.pointer, "radius"], 30, 400, 5);
  check(inter, "click splash", [config.pointer, "splash"]);

  // Export
  const exp = section("Export", true);
  exp.append(el("div", { className: "btns" },
    el("button", { className: "primary", textContent: "copy link", onclick: () => { persist(); setTimeout(() => navigator.clipboard.writeText(location.href).then(() => toast("link copied")), 300); } }),
    el("button", { textContent: "copy JSON", onclick: () => navigator.clipboard.writeText(JSON.stringify(config, null, 2)).then(() => toast("JSON copied")) }),
    el("button", { textContent: "reset", onclick: () => { applyConfig({}); reseed(); persist(); build(); toast("reset"); } }),
    el("button", { textContent: "reshuffle", onclick: () => reseed() }),
  ));
  exp.append(el("div", { className: "hint" }, "H hides the panel · click the water to splash."));
}
build();

// ── panel show / hide ────────────────────────────────────────────────
const panel = document.getElementById("panel")!;
const toggleBtn = document.getElementById("toggle")!;
const setHidden = (h: boolean) => { panel.classList.toggle("hidden", h); toggleBtn.classList.toggle("show", h); };
document.getElementById("hide")!.onclick = () => setHidden(true);
toggleBtn.onclick = () => setHidden(false);
addEventListener("keydown", (e) => {
  if (e.key.toLowerCase() === "h" && !(e.target instanceof HTMLInputElement)) setHidden(!panel.classList.contains("hidden"));
});
// Clicks on the panel shouldn't splash the water behind it.
for (const n of [panel, toggleBtn]) n.addEventListener("pointerdown", (e) => e.stopPropagation());
