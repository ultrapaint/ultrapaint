import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const serverPort = Number(process.env.ULTRAPAINT_PORT ?? 4770);
const webPort = Number(process.env.ULTRAPAINT_WEB_PORT ?? 4771);

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: "127.0.0.1",
    port: webPort,
    strictPort: true,
    proxy: {
      "/api": { target: `http://127.0.0.1:${serverPort}` },
      "/ws": { target: `ws://127.0.0.1:${serverPort}`, ws: true },
    },
  },
  build: { outDir: "dist", sourcemap: true },
});
