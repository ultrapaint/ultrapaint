# ADR 0007: Component catalogue

Status: accepted, 2026-09-17.

TypeScript 7 (the native compiler) ships no JavaScript compiler API, so the server depends on
TypeScript 5 under the alias `typescript-api` for the catalogue only. A program over the library
directories yields exported components, their props (declared in the repository, plus an
allowlist of common HTML props), literal unions as enums, JSDoc, and required flags. `cva()`
calls are parsed with Babel for variant members and defaults. Results are cached under the tool
home keyed by file mtimes and a version constant. On epicparty: 327 components, 325 with usable
metadata, about 8 s cold, instant from cache.
