import { defineConfig } from "vite";
import { resolve } from "path";

export default defineConfig(({ mode }) => ({
  build: {
    outDir: "dist",
    emptyOutDir: false,
    lib: {
      entry: resolve(__dirname, mode === "manga" ? "src/content/manga-entry.ts" : "src/content/content.ts"),
      formats: ["iife"],
      name: mode === "manga" ? "AstraMangaContent" : "AstraContent",
      fileName: () => mode === "manga" ? "manga-content.js" : "content.js",
    },
    rollupOptions: {
      output: {
        extend: true,
        inlineDynamicImports: true,
      },
    },
    target: "es2020",
    minify: "esbuild",
  },
  resolve: {
    alias: {
      "@shared": resolve(__dirname, "src/shared"),
      "@styles": resolve(__dirname, "src/styles"),
    },
  },
}));
