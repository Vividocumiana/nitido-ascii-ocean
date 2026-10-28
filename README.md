# Nitido ASCII ocean

ASCII creatures for the Nitido Studio plans, plus the configurator used to tune them.

| Plan   | Creature  | Behaviour                     |
| ------ | --------- | ----------------------------- |
| Base   | Goldfish  | Small school, bursts and hovers |
| Studio | Koi       | Slowly circle each other      |
| Plus   | Dolphins  | Side view, play and roll in 3D |

Built on the ASCII sharks engine by drewdi ([stackedlol/ascii-sharks](https://github.com/stackedlol/ascii-sharks), MIT).

```sh
npm install
npm run dev
```

## Pages

- `/creatures.html` — the configurator: plan cards, per-plan quantity, cell, background, size, opacity and speed, a Looks gallery, export to link or JSON. The dark ocean behind it is the LinkedIn visual.
- `/` — the original shark configurator.
- `/card.html` — an earlier "site creature" exploration, kept for reference.

## Code

- `src/creatures.ts` — `CreatureScene`, the new engine: goldfish, koi and dolphins with a path-following spine, real gaits (burst, continuous, stroke and glide), social behaviour and walls that keep creatures off the card text.
- `src/engine.ts`, `src/world.ts`, `src/renderer.ts` — the original shark engine, now with a config per instance and a left wall.
- `creatures.ts` — the configurator page.

```ts
import { CreatureScene } from "./src/creatures";

new CreatureScene(canvas, {
  creature: "koi", count: 2, size: 0.4, cell: 10, background: "#f3f3f2",
  opacity: 1, speed: 1, grid: false, debug: false,
  area: { x0: 0, y0: 0, x1: 1, y1: 1 },
});
```
