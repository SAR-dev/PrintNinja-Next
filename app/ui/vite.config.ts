import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { createRequire } from "node:module";
import path from "path";

const require = createRequire(import.meta.url);
const pkg = require("./package.json") as { version: string };

export default defineConfig({
  plugins: [react()],
  // Outside the tree `tauri dev` watches: while the dep optimizer
  // rebuilds its cache it writes temp files into node_modules/.vite,
  // and every one of those made the dev watcher kill and restart the
  // app in a loop (with the single-instance plugin, the restart
  // races left no window at all).
  cacheDir: path.resolve(__dirname, "../../.vite-cache"),
  // Build-baked app version for web mode, where Tauri's getVersion() is
  // unavailable. Single source of truth: package.json.
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
  },
});
