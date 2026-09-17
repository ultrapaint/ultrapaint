import { fileURLToPath } from "node:url";
import babel from "@rolldown/plugin-babel";
import tailwindcss from "@tailwindcss/vite";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const serverPort = Number(process.env.ULTRAPAINT_PORT ?? 4770);
const webPort = Number(process.env.ULTRAPAINT_WEB_PORT ?? 4771);

export default defineConfig({
  build: { outDir: "dist", sourcemap: true },
  plugins: [
    react(),
    babel({ presets: [reactCompilerPreset()] }),
    tailwindcss(),
  ],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  server: {
    host: "127.0.0.1",
    port: webPort,
    proxy: {
      "/api": { target: `http://127.0.0.1:${serverPort}` },
      "/ws": { target: `ws://127.0.0.1:${serverPort}`, ws: true },
    },
    strictPort: true,
  },
});
