import { config } from "./src/config";
import { SiteScene, type SceneOptions, type SiteData } from "./src/site";

// The creature drifts and never hunts; visitors only shy away a little.
Object.assign(config.predators, { hunger: 0, avoidCenter: false, fear: 0.45, speed: 0.5, agility: 1.25 });
Object.assign(config.prey, { speed: 0.75, jitter: 0.8 });
Object.assign(config.pointer, { radius: 70 });

// Example sites, shaped like the data the platform already has for each site.
// "standard" is the site today; "plus" is the same site once it has grown.
const SITES: Record<string, { standard: SiteData; plus: SiteData }> = {
  Halo: {
    standard: {
      name: "Halo", brand: "#3E63DD", visits24h: 640,
      sections: [
        { type: "hero", headline: "Banking for teams that move fast" },
        { type: "logos", headline: "Trusted by 2,000 startups" },
        { type: "features", headline: "Cards, spend controls, real-time sync" },
        { type: "footer", headline: "Halo Inc. 2026" },
      ],
      pages: ["About", "Pricing"],
    },
    plus: {
      name: "Halo", brand: "#3E63DD", visits24h: 1840,
      sections: [
        { type: "hero", headline: "Banking for teams that move fast" },
        { type: "logos", headline: "Trusted by 2,000 startups" },
        { type: "features", headline: "Cards, spend controls, real-time sync" },
        { type: "product", headline: "One dashboard for every euro" },
        { type: "testimonials", headline: "Our CFO finally sleeps" },
        { type: "pricing", headline: "Simple plans, no surprises" },
        { type: "cta", headline: "Open an account in five minutes" },
        { type: "footer", headline: "Halo Inc. 2026" },
      ],
      pages: ["About", "Pricing", "Blog", "Careers", "Docs", "Changelog"],
    },
  },
  Orto: {
    standard: {
      name: "Orto", brand: "#2F8F5B", visits24h: 320,
      sections: [
        { type: "hero", headline: "Vegetables from farms near you" },
        { type: "how", headline: "Pick, we harvest, you cook" },
        { type: "footer", headline: "Orto Milano" },
      ],
      pages: ["Box"],
    },
    plus: {
      name: "Orto", brand: "#2F8F5B", visits24h: 1210,
      sections: [
        { type: "hero", headline: "Vegetables from farms near you" },
        { type: "how", headline: "Pick, we harvest, you cook" },
        { type: "farms", headline: "Meet the twelve farmers" },
        { type: "recipes", headline: "Recipes for this week's box" },
        { type: "reviews", headline: "Best tomatoes in Milan" },
        { type: "footer", headline: "Orto Milano" },
      ],
      pages: ["Box", "Farms", "Recipes", "Journal", "Gift"],
    },
  },
  Atelier: {
    standard: {
      name: "Atelier Rossi", brand: "#DF4125", visits24h: 210,
      sections: [
        { type: "hero", headline: "Architecture for quiet places" },
        { type: "projects", headline: "Selected work 2014-2026" },
        { type: "contact", headline: "Write to the studio" },
        { type: "footer", headline: "Atelier Rossi" },
      ],
      pages: ["Studio", "Projects"],
    },
    plus: {
      name: "Atelier Rossi", brand: "#DF4125", visits24h: 760,
      sections: [
        { type: "hero", headline: "Architecture for quiet places" },
        { type: "projects", headline: "Selected work 2014-2026" },
        { type: "process", headline: "Drawing first, always" },
        { type: "press", headline: "Domus, Abitare, Wallpaper" },
        { type: "team", headline: "Seven people, one table" },
        { type: "contact", headline: "Write to the studio" },
        { type: "footer", headline: "Atelier Rossi" },
      ],
      pages: ["Studio", "Projects", "Journal", "Press", "Contact"],
    },
  },
};

let siteKey = "Halo";
let brandOverride: string | null = null;
const opts: SceneOptions = { style: "linear", intensity: 0.55, cell: 8, background: "#f3f3f2", visitsPerFish: 10 };

const withBrand = (s: SiteData): SiteData => ({ ...s, brand: brandOverride ?? s.brand });

const standardCard = document.getElementById("standard")!;
const plusCard = document.getElementById("plus")!;
const standard = new SiteScene(standardCard.querySelector("canvas")!, withBrand(SITES[siteKey].standard), { ...opts });
const plus = new SiteScene(plusCard.querySelector("canvas")!, withBrand(SITES[siteKey].plus), { ...opts });
const scenes = [standard, plus];

function meta() {
  const fmt = (n: number) => n.toLocaleString("en-US");
  const s = SITES[siteKey];
  standardCard.querySelector(".meta")!.textContent = `${s.standard.sections.length} sections · ${s.standard.pages.length} pages · ${fmt(s.standard.visits24h)} visits / 24h`;
  plusCard.querySelector(".meta")!.textContent = `${s.plus.sections.length} sections · ${s.plus.pages.length} pages · ${fmt(s.plus.visits24h)} visits / 24h`;
}

function loadSite() {
  standard.setSite(withBrand(SITES[siteKey].standard));
  plus.setSite(withBrand(SITES[siteKey].plus));
  for (const sc of scenes) sc.reseed();
  meta();
}
meta();

// Hovering "Upgrade to Plus" previews the growth: the Standard creature stretches into the Plus one.
const upgrade = document.getElementById("upgrade")!;
upgrade.addEventListener("pointerenter", () => standard.setSite(withBrand(SITES[siteKey].plus)));
upgrade.addEventListener("pointerleave", () => standard.setSite(withBrand(SITES[siteKey].standard)));

// ── controls ─────────────────────────────────────────────────────────
const controls = document.getElementById("controls")!;
const h = (html: string) => {
  const t = document.createElement("template");
  t.innerHTML = html.trim();
  return t.content.firstElementChild as HTMLElement;
};

const siteSel = h(`<label>site <select>${Object.keys(SITES).map((k) => `<option>${k}</option>`).join("")}</select></label>`);
siteSel.querySelector("select")!.onchange = (e) => {
  siteKey = (e.target as HTMLSelectElement).value;
  brandOverride = null;
  brand.querySelector("input")!.value = SITES[siteKey].standard.brand;
  loadSite();
};

const brand = h(`<label>brand colour <input type="color" value="${SITES[siteKey].standard.brand}"></label>`);
brand.querySelector("input")!.oninput = (e) => {
  brandOverride = (e.target as HTMLInputElement).value;
  standard.setSite(withBrand(SITES[siteKey].standard));
  plus.setSite(withBrand(SITES[siteKey].plus));
};

const style = h(`<div class="seg"><button class="on">linear</button><button>soft fill</button></div>`);
style.querySelectorAll("button").forEach((b, i) => (b.onclick = () => {
  style.querySelectorAll("button").forEach((x) => x.classList.remove("on"));
  b.classList.add("on");
  for (const sc of scenes) sc.opts.style = i === 0 ? "linear" : "soft";
}));

const intensity = h(`<label>intensity <input type="range" min="0" max="1" step="0.05" value="${opts.intensity}"></label>`);
intensity.querySelector("input")!.oninput = (e) => { for (const sc of scenes) sc.opts.intensity = Number((e.target as HTMLInputElement).value); };

const cell = h(`<label>cell <input type="range" min="5" max="14" step="1" value="${opts.cell}"></label>`);
cell.querySelector("input")!.oninput = (e) => { for (const sc of scenes) sc.setCell(Number((e.target as HTMLInputElement).value)); };

const perFish = h(`<label>1 dash = <select><option>5</option><option selected>10</option><option>25</option><option>50</option></select> visits</label>`);
perFish.querySelector("select")!.onchange = (e) => {
  for (const sc of scenes) { sc.opts.visitsPerFish = Number((e.target as HTMLSelectElement).value); sc.reseed(); }
};

controls.append(siteSel, brand, style, intensity, cell, perFish);
