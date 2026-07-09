import { defineConfig } from "vitest/config";

// UNIT LANE — pure-sim tests only (node env, no WebGL, no DOM). These run in
// vitest's parallel worker pool OUTSIDE the GPU guard lock (the fast CPU lane);
// anything needing a real GL context or the full app stays a browser smoke.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // pure-sim only: a test that pulls in a WebGLRenderer belongs in the smoke fleet
    exclude: ["node_modules/**", "dist/**", "scripts/**"],
    reporters: "dot",
  },
});
