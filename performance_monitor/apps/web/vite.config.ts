import path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const dir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(dir, "src"),
    },
  },
  server: {
    host: "0.0.0.0",
    port: 47321,
    strictPort: true,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:47322",
        changeOrigin: true,
        ws: true,
        rewrite: (requestPath) => requestPath.replace(/^\/api/, ""),
      },
    },
  },
  preview: {
    host: "0.0.0.0",
    port: 47321,
    strictPort: true,
  },
});
