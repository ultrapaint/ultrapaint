# ADR 0144: Connect runs an outside agent's own registration

Status: accepted, 2026-11-24. Amends 0083 (registration was the person's to run).

## Context

ADR 0083 made one line per agent the way an outside agent reaches every project:
`claude mcp add ultrapaint -s user -- ultrapaint mcp`, and `codex mcp add ultrapaint -- ultrapaint
mcp`. Settings › Connections showed each line with Copy, under "Run one of these once". Connecting
meant leaving the editor for a terminal, pasting, and coming back, with nothing in the editor to
say whether it worked or had been done before. Nothing in Ultrapaint ran these lines, wrote an
agent's MCP settings (`~/.claude.json`, `~/.codex/config.toml`) or kept a record of a connection.

The pieces were there: the server runs programs to their end with their output (`runCommand`),
each built-in agent's descriptor names its program and where to install it, and the desktop app
hands the server the executables it found (the agent runtime, ADR 0031).

## Decision

**Connect runs the agent's own line, and is the one place Ultrapaint changes an agent's
settings.** Each outside agent's row in Settings › Connections, Claude Code's and Codex's, has
**Connect** beside its line. It runs that line, the same one the row shows to copy (contracts'
`OUTSIDE_AGENTS`), with the agent's own program. Ultrapaint never edits an agent's files itself.
There is no confirmation, since the click is the consent, and no Disconnect: removing the
registration stays the agent's own `mcp remove`, run by the person.

**The agent's answer is the only record.** A row reads **Connected** when the agent itself lists
Ultrapaint: `claude mcp get ultrapaint` and `codex mcp get ultrapaint`, which exit 0 for a server
they list and 1, saying "No MCP server named …", for one they do not. Both also exit 1 when they
can't read their own configuration (a corrupted `~/.claude.json`, a `config.toml` that does not
parse), so an exit 1 without that message, like any other exit, is the agent failing to say, and
the row says so in its words. `claude mcp list` is not used, since it starts every server it lists to
check it. `claude mcp get` (2.1.331) still health-checks the one server it names: each opening
starts `ultrapaint mcp` once in the home folder, which finds no project there and starts no
server (ADR 0083). `codex mcp get` starts nothing. The question is asked each time the section opens, so a registration
removed in a terminal no longer reads as connected, and Ultrapaint keeps nothing of its own. Both
commands run in the home folder, so a registration scoped to one project does not count, and
with a timeout (30 seconds each, since Claude Code's health check tries twice), after which the
row says the agent didn't answer.

**The server runs them, on its machine.** `OutsideAgents` (one service, `mcp.outsideAgents` and
`mcp.connectAgent`) runs the commands as the server's own children, outside any agent's sandbox
(ADR 0013). The desktop app, a browser and a project opened over SSH all behave the same, and
over SSH the agent connected is the one on the project's machine, which is the one that reaches
the project by its folder (ADR 0083).

**An outside agent is one the person runs themselves.** The program is the one the desktop app
found for the agent (the runtime's executable) or else the one on the server's PATH. The copy the
app downloads for its own threads where the person has none is not theirs to run: the runtime
marks it (`downloaded`), the server looks on its own PATH instead, and with none there the row
reads not installed, with the descriptor's install link, as a missing program's does. Only Claude Code and Codex have rows. A custom agent
has no known command.

**The `ultrapaint` command is looked for, not required.** Connecting goes ahead when `ultrapaint`
is not on the server's PATH, and a connected row says the agent can't start Ultrapaint until it
is. In the desktop app, Command line installs it (ADR 0088; Ultrapaint Dev leaves it to the
release, ADR 0113).

**A failure is the command's own words.** A line that exits with an error answers `CommandFailed`
with its stderr, else its stdout, shown under the row with Connect again.

**Hubs are not detected.** An agent that reaches Ultrapaint through an MCP hub lists the hub,
not `ultrapaint`, and a hub's list can't be read without starting it. Its row reads not
connected. One line under the section tells a person whose agent uses a hub to leave its row as
it is, since Connect is the one change the editor makes that it can't take back.

## Consequences

- An outside agent is connected from the editor in one click, in the desktop app, a browser or
  over SSH, and the section says each agent's state as the agent itself sees it.
- Opening Connections runs each installed agent's `mcp get`: a process per agent, and with Claude
  Code connected one `ultrapaint mcp` for its health check, every time the section opens.
- Ultrapaint now changes something outside the project: an agent's user-level MCP settings, by
  that agent's own command, on the person's click, and nowhere else.
- A person with a hub sees Not connected on rows that work through the hub; the line under the
  section is what tells them so.
