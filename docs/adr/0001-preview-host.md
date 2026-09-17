# ADR 0001: Preview host

Status: superseded by 0011. Accepted 2026-09-17. Supersedes D3 and D13 in the work definition and plan.

## Context

Screens must render with the target repository's real design system, Tailwind entry, fonts
and React copy. The product apps need Convex and SST, so their dev servers are unsuitable.
epicparty overrides `vite` with `@voidzero-dev/vite-plus-core`, which ships no `vite` binary.

## Decision

The backend generates `<designs>/.ultrapaint/{serve.mjs,vite.config.ts,index.html,main.tsx,host.css}`
and spawns `node serve.mjs <port>` with the designs package as working directory. `serve.mjs`
calls `createServer` from whatever `vite` resolves to from the designs package. The config adds
three plugins: our stamping plugin (loaded by absolute path from a self-contained bundle), the
target's `@vitejs/plugin-react` and `@tailwindcss/vite`. The entry loads screens through
`import.meta.glob` and wraps them with an optional providers module from settings. All screen
and design-system files are listed as `optimizeDeps.entries` so Vite pre-bundles every
dependency once; late discovery re-optimises and can load a second React copy.

## Consequences

- The designs directory must be a package that depends on `react`, `react-dom`, `vite`,
  `@vitejs/plugin-react`, `@tailwindcss/vite` and the design system. Settings validation says so.
- Nothing is installed into the target repository; the generated directory is gitignored.
- The host is stopped by the PID we spawned.
