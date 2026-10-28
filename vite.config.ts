import { defineConfig } from "vite";

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        creatures: "creatures.html",
        ocean: "index.html",
        card: "card.html",
      },
    },
  },
});
