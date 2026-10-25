import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  publicDir: "web-public",
  server: {
    port: 5181,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8787",
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: "dist-web",
    emptyOutDir: true,
    target: "esnext",
    minify: "esbuild",
    sourcemap: false,
    rollupOptions: {
      input: {
        // Emitted as dist-web/index.html (server static root expects this name)
        index: resolve(__dirname, "web.html"),
      },
    },
  },
});
