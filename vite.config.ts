import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Electron loads dist/index.html via file:// so asset paths must be relative.
export default defineConfig({
  base: "./",
  plugins: [react()],
  build: {
    outDir: "dist",
    assetsDir: "assets",
  },
});
