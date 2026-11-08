import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { fileURLToPath } from "node:url";

const desktopRoot = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: path.join(desktopRoot, "src", "renderer"),
  base: "./",
  plugins: [react()],
  build: {
    outDir: path.join(desktopRoot, "dist", "renderer"),
    emptyOutDir: true,
  },
});
