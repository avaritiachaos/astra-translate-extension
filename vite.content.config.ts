import { defineConfig } from "vite";
import { resolve } from "path";

export default defineConfig({
  build: {
    outDir: "dist",
    emptyOutDir: false,
    lib: {
      entry: resolve(__dirname, "src/content/content.ts"),
      formats: ["iife"],
      name: "AstraContent",
      fileName: () => "content.js",
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
});
