# PLAN: agents outside the editor (ADR 0083)

Each slice ships on its own, tested, and leaves the product working.

1. **`ultrapaint mcp`, by the folder.** The stdio command: find the configuration upwards, read
   `run.json` and `mcp-token`, pass messages to `/mcp` (JSON or event-stream answers, the session
   header of older revisions passed along), read the run file again when a call cannot connect.
   The server writes `mcp-token` when it starts. A project with no server: say so for now.
   Settings show the one-time `claude mcp add` and Codex lines. Docs: `docs/user/agents.md`.
2. **Start a server without a window.** No server running: the command starts one
   (`--port 0 --ready-json --stop-with-stdin`) and holds it. A server an editor is connected to
   outlives its stdin and stops when the last editor leaves; the app attaches to it as it
   attaches to any running server.
3. **Install Command Line Tool.** The desktop app's menu links `ultrapaint` into the PATH, on
   macOS and Linux; the Settings row says to use it when the command is not found.
4. **Links name the project.** The copied link carries the project's folder; the command routes a
   call given a link to that project's server; tools take the whole link. Folders the app keeps a
   session for are found through its project list.
5. **The selection.** A read-only tool for what is selected in the editor open on the project,
   within the budget test.
