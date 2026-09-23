import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { viteSingleFile } from "vite-plugin-singlefile";

// INTERNAL ops dashboard: built to ops-dist/ops.html, never deployed to GitHub Pages.
export default defineConfig({
  plugins: [react(), viteSingleFile()],
  base: "./",
  build: { outDir: "ops-dist", emptyOutDir: true, rollupOptions: { input: "ops.html" } },
});
