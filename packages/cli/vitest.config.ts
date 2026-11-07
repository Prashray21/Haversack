import path from "node:path";
import { defineConfig } from "vitest/config";

// Resolve @haversackhq/core to its TypeScript source so tests run without a build.
export default defineConfig({
  resolve: {
    alias: {
      "@haversackhq/core": path.resolve(import.meta.dirname, "../core/src/index.ts"),
    },
  },
  test: {
    environment: "node",
  },
});
