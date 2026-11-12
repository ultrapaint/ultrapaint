# PLAN: agents outside the editor (ADR 0083)

Each slice ships on its own, tested, and leaves the product working.

1. (Done, 2026-11-12.) **`ultrapaint mcp`, by the folder.** The stdio command: find the configuration upwards, read
   `run.json` and `mcp-token`, pass messages to `/mcp` (JSON or event-stream answers, the session
   header of older revisions passed along), read the run file again when a call cannot connect.
   The server writes `mcp-token` when it starts. A folder with no project connects, offering no
   tools, and says why.
   Settings show the one-time `claude mcp add` and Codex lines. Docs: `docs/user/agents.md`.
2. (Done, 2026-11-12.) **Start a server without a window.** No server running: the command starts one
   (`--port 0 --ready-json --stop-with-stdin`) and holds it. A server an editor is connected to
   outlives its stdin and stops when the last editor leaves; the app attaches to it as it
   attaches to any running server.
3. (Done, 2026-11-12.) **Install the command.** The desktop app writes an `ultrapaint` launcher
   of its own server into the PATH, on macOS and Linux, from the Settings row, which offers it
   when the command is not found (the app has no menu of its own).
4. (Done, 2026-11-12.) **Links name the project.** The copied link carries the project's folder;
   the command routes a call given a link, and the calls after it, to that project's server; a
   folder with no project offers the tools last listed. A folder without a configuration file is
   told to save one, not looked for in the desktop app's data.
5. (Done, 2026-11-12.) **The selection.** The editor says its selection to its server as it
   changes; `get_context` returns it, so no tool is added.
