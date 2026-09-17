# Spike findings

The four spikes were run as part of the real implementation rather than as throwaway code;
the measurements below come from the built tool against epicparty on the reference machine.

## S1 Canvas embedding

- One iframe per screen, positioned in a CSS-transformed surface. Two live frames, pan and zoom
  by wheel and pinch, virtualisation of frames outside the viewport. Pointer events reach the
  frame in interact mode; in select mode a transparent overlay hit-tests through `postMessage`.
- Not measured: sustained frame rate with 8 or 12 frames. The virtualisation path exists; a
  scripted measurement is future work.

## S2 Source mapping and edit round trip

- Stamping works on Vite 8 (rolldown) as a pre-transform, independent of the React plugin.
- Click to source is exact in every verified case, including design-system instances.
- Edit round trip: about 0.7 s (write, two Biome processes, HMR, tree refresh). Budget was
  300 ms; the gap is process startup for the formatter.
- `biome check` on the edited file passes; diffs are one attribute.

## S3 ACP round trip

- Claude Code (`@agentclientprotocol/claude-agent-acp` 0.78): initialize, session/new with
  modes and config options, prompt with tool calls, permission request and decision, cancel,
  changed-file attribution. All verified.
- Codex (`@agentclientprotocol/codex-acp` 1.12): initialize with auth methods, session/new
  with config options, prompt accepted by the adapter and refused by the account's usage
  limit. The protocol path is complete; the account was the blocker on the day.
- Launch configuration needs: command, args, env. Both run through `npx` and use the
  installed CLIs' logins. Nothing agent-specific exists outside `packages/acp/src/configs.ts`.

## S4 Component catalogue

- 327 exported components, 325 with usable prop metadata (99 %), 8 s cold, cached after.
- `cva` variants and defaults extracted for `Button` and the others that use `cva`.
- A `Badge` inserted from the catalogue rendered with its import added.
- Storybook stories use `render()` functions, so they serve as previews only when a Storybook
  URL is configured; there are no CSF args to reuse.
