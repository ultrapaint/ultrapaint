import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  // The application's backend, as `vite dev` reaches it: `pnpm e2e:sandbox` starts one.
  server: {
    proxy: { "/api": process.env.SANDBOX_HOST_API ?? "http://127.0.0.1:9" },
  },
});
