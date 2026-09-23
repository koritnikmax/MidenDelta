import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { viteSingleFile } from "vite-plugin-singlefile";

// Single self-contained index.html: can be served by any static host (Vercel, Netlify, python -m http.server)
export default defineConfig({ plugins: [react(), viteSingleFile()], base: "./" });
