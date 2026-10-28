import type { SharkSpec } from "./world";

/**
 * Live, mutable scene config. World and renderer read it every frame, so
 * most changes apply instantly; the ones marked "reseed" need World.seed().
 */
export interface OceanConfig {
  /** Global simulation speed (0 = paused). */
  timeScale: number;
  /** Strength of the ambient current that drifts schools around. */
  current: number;

  scene: {
    background: string;
    grid: boolean;
    gridAlpha: number;
    wake: boolean;
    wakeColor: string;
    /** How long wakes linger (lower = longer trails). */
    wakeDecay: number;
    eatFlash: boolean;
    /** ASCII cell width in px; 0 = automatic from screen width. Height follows (×1.45). */
    cellSize: number;
    /** Fade the creatures out behind a centred headline (0 = off). */
    centerFade: number;
  };

  prey: {
    /** 0 = automatic from screen area. Reseed. */
    count: number;
    glyph: string;
    color: string;
    speed: number;
    align: number;
    cohesion: number;
    jitter: number;
    mill: number;
    /** Relative odds per species; 0 disables it. Reseed. */
    weights: Record<string, number>;
  };

  predators: {
    /** Reseed. */
    list: SharkSpec[];
    speed: number;
    agility: number;
    /** How fast hunger builds; 0 = they never hunt. */
    hunger: number;
    /** Keep the centre of the frame clear (for a headline). */
    avoidCenter: boolean;
    /** How far away prey notice them. */
    fear: number;
    /** 1 = full colour, lower blends the body into the background. */
    opacity: number;
    /** Brightness of the skin blocks. */
    tone: number;
    /** How often coloured accent glyphs show up (0 = monochrome). */
    accents: number;
    /** Single accent colour; empty = the original multicolour shimmer. */
    accentColor: string;
    /** Koi skin patches. */
    patchColor: string;
    /** 0 = almost all white, 1 = almost all patch. */
    patchAmount: number;
  };

  pointer: {
    repel: boolean;
    radius: number;
    splash: boolean;
  };
}

export const DEFAULT_CONFIG: OceanConfig = {
  timeScale: 1,
  current: 1,
  scene: {
    background: "#000000",
    grid: true,
    gridAlpha: 0.055,
    wake: true,
    wakeColor: "#6ee6ff",
    wakeDecay: 1.5,
    eatFlash: true,
    cellSize: 0,
    centerFade: 0,
  },
  prey: {
    count: 0,
    glyph: "-",
    color: "#e6eeff",
    speed: 1,
    align: 1,
    cohesion: 1,
    jitter: 1,
    mill: 1,
    weights: { sardine: 3, anchovy: 3, silverside: 3, mackerel: 2, goby: 1 },
  },
  predators: {
    list: [
      { kind: "classic", size: 1 },
      { kind: "classic", size: 0.7 },
      { kind: "classic", size: 0.84 },
      { kind: "classic", size: 0.77 },
    ],
    speed: 1,
    agility: 1,
    hunger: 1,
    avoidCenter: true,
    fear: 1,
    opacity: 1,
    tone: 1,
    accents: 1,
    accentColor: "",
    patchColor: "#DF4125",
    patchAmount: 0.5,
  },
  pointer: { repel: true, radius: 130, splash: true },
};

export const cloneConfig = (c: OceanConfig): OceanConfig => JSON.parse(JSON.stringify(c));

/**
 * The config the sim and renderer read. It's a live binding: each OceanEngine points it at
 * its own config before stepping or drawing, so several oceans can look different.
 */
export let config: OceanConfig = cloneConfig(DEFAULT_CONFIG);

export function useConfig(c: OceanConfig) {
  config = c;
}

/** Copy a (possibly partial) config into the live one, keeping the same object. */
export function applyConfig(next: Partial<OceanConfig>) {
  const merged = cloneConfig(DEFAULT_CONFIG);
  for (const k of Object.keys(next) as (keyof OceanConfig)[]) {
    const v = next[k];
    if (v && typeof v === "object" && !Array.isArray(v)) Object.assign(merged[k] as object, v);
    else if (v !== undefined) (merged as any)[k] = v;
  }
  Object.assign(config, merged);
}

/** Hex "#rrggbb" → [r, g, b]. */
export function hexRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace("#", ""), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Perceived lightness 0..1 of a hex colour. */
export function luminance(hex: string) {
  const [r, g, b] = hexRgb(hex);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}
