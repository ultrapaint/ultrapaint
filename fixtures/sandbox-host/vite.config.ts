import path from "node:path";
import babel from "@rolldown/plugin-babel";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  // The backend's address, which a stylesheet of another site is linked from.
  define: {
    __SANDBOX_BACKEND__: JSON.stringify(process.env.SANDBOX_HOST_API ?? ""),
  },
  plugins: [
    react(),
    // StyleX as it develops: its rules injected at run time, into a `<style>` of the head.
    babel({
      include: /stylex\.tsx$/,
      plugins: [
        [
          "@stylexjs/babel-plugin",
          {
            dev: true,
            runtimeInjection: true,
            unstable_moduleResolution: {
              rootDir: import.meta.dirname,
              type: "commonJS",
            },
          },
        ],
      ],
    }),
  ],
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  // The application's backend, as `vite dev` reaches it: `pnpm e2e:sandbox` starts one.
  server: {
    proxy: { "/api": process.env.SANDBOX_HOST_API ?? "http://127.0.0.1:9" },
  },
});
