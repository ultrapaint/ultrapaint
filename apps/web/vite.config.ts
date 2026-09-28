import { fileURLToPath } from "node:url";
import babel from "@rolldown/plugin-babel";
import tailwindcss from "@tailwindcss/vite";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const serverPort = Number(process.env.ULTRAPAINT_PORT ?? 4770);
const webPort = Number(process.env.ULTRAPAINT_WEB_PORT ?? 4771);
// The same address as the server, so the editor is reached from another machine with it.
const host = process.env.ULTRAPAINT_HOST ?? "127.0.0.1";
const serverHost = host === "0.0.0.0" || host === "::" ? "127.0.0.1" : host;

export default defineConfig({
  build: { outDir: "dist", sourcemap: true },
  plugins: [
    react(),
    babel({ presets: [reactCompilerPreset()] }),
    tailwindcss(),
  ],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  server: {
    host,
    port: webPort,
    proxy: {
      "/api": { target: `http://${serverHost}:${serverPort}` },
      "/ws": { target: `ws://${serverHost}:${serverPort}`, ws: true },
    },
    strictPort: true,
  },
});
