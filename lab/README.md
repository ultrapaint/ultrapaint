# lab

Tools for working on ultrapaint itself, never shipped. Nothing in `apps/` or `packages/` imports
from here, `scripts/pack.ts` leaves it out, and it is not a pnpm workspace package: each tool runs
with `node` from the checkout, on the root's dependencies, and reaches the product only through
its public surfaces (the `ultrapaint` command, the editor's RPC contracts, the MCP server).

- [`design-evals/`](design-evals/README.md): finds what the shipped design skills fail to teach,
  by having agents remake screens someone already made well, and comparing.
