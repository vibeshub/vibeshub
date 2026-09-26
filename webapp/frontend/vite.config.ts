import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Node 25+ pre-defines a stub `localStorage` global (undefined unless
// --localstorage-file is set). vitest's jsdom env skips globals that already
// exist, so every component touching localStorage crashed under test. Turn the
// built-in off so jsdom's Storage wins. The flag only exists from Node 22.
const nodeMajor = Number(process.versions.node.split(".")[0]);
const workerExecArgv = nodeMajor >= 22 ? ["--no-experimental-webstorage"] : [];

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": "http://127.0.0.1:8000",
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    poolOptions: {
      forks: { execArgv: workerExecArgv },
      threads: { execArgv: workerExecArgv },
    },
    clearMocks: true,
    setupFiles: ["./src/tests/setup.ts"],
    passWithNoTests: true,
    include: ["src/**/*.test.{ts,tsx}"],
    exclude: ["node_modules", "dist", "e2e"],
  },
});
