import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";
import {
  readFileSync,
  writeFileSync,
  existsSync,
  rmSync,
} from "fs";

// Post-build: move HTML files to dist root and fix script references
function fixHtmlPlugin() {
  return {
    name: "fix-html",
    closeBundle() {
      const distDir = resolve(__dirname, "dist");

      // Fix popup.html
      const popupSrc = resolve(distDir, "src/popup/popup.html");
      const popupDst = resolve(distDir, "popup.html");
      if (existsSync(popupSrc)) {
        let html = readFileSync(popupSrc, "utf-8");
        if (!html.includes("popup-entry")) {
          html = html.replace(
            "</body>",
            '  <script type="module" src="/popup-entry.js"></script>\n</body>'
          );
        }
        writeFileSync(popupDst, html);
      }

      // Fix options.html
      const optionsSrc = resolve(distDir, "src/options/options.html");
      const optionsDst = resolve(distDir, "options.html");
      if (existsSync(optionsSrc)) {
        let html = readFileSync(optionsSrc, "utf-8");
        if (!html.includes("options-entry")) {
          html = html.replace(
            "</body>",
            '  <script type="module" src="/options-entry.js"></script>\n</body>'
          );
        }
        writeFileSync(optionsDst, html);
      }

      // Clean up dist/src
      const srcDir = resolve(distDir, "src");
      if (existsSync(srcDir)) {
        rmSync(srcDir, { recursive: true, force: true });
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), fixHtmlPlugin()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        popup: resolve(__dirname, "src/popup/popup.html"),
        options: resolve(__dirname, "src/options/options.html"),
        "popup-entry": resolve(__dirname, "src/popup/Popup.tsx"),
        "options-entry": resolve(__dirname, "src/options/Options.tsx"),
        "service-worker": resolve(
          __dirname,
          "src/background/service-worker.ts"
        ),
      },
      output: {
        entryFileNames: (chunk) => {
          if (chunk.name === "service-worker") return "service-worker.js";
          if (chunk.name === "popup-entry") return "popup-entry.js";
          if (chunk.name === "options-entry") return "options-entry.js";
          return "assets/[name]-[hash].js";
        },
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]",
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
