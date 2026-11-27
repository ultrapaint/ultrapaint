# ADR 0164: `ultrapaint mcp` answers `initialize` itself while the project's server starts

Status: accepted, 2026-11-27. Amends 0083 (a call without a folder, `initialize` among them, was
passed to the project's server).

## Context

An agent's client starts `ultrapaint mcp` and sends MCP's `initialize`; clients and hubs commonly
give a server 30 s to answer it before they drop it. Under ADR 0083 the command passed `initialize`
to the project's server like any other message, so in a project's folder with no server running it
first started that server and waited for its ready line. That took 21 s on a Linux workstation
(UP-243; 24 s measured again for this change), and longer on a cold laptop or a machine starting
several MCP servers at once: a hub logged `ultrapaint: started, but did not answer within 30s` and
connected only on a later attempt.

The relay already says `initialize` to a server that has not heard it, for a server that
restarted or a call a link turned to another project (`initializeAt`), so a server can be told it
later than the agent said it.

## Decision

**With no server running for the project, the command answers `initialize` itself, and starts that
server meanwhile.** A server that runs, by its run file, is passed `initialize` as before, and
answers it in its own words; one whose run file names a server that answers no more is treated as
none running. The command's own answer is the one the project's server gives: the revision it agrees
(the one asked when it is one of the server's session revisions, else its newest), what it can do
(tools, prompts and resources whose lists may change, logging, completions), who it is, and its
instructions. The server's identity and revisions are `MCP_SERVER_INFO` and `MCP_PROTOCOLS`
(`services/mcp/route.ts`), which the server is made from too; a test holds the command's answer to
the server's. The server is told `initialize`, as the agent said it, and `notifications/initialized`
before the first call that needs a session; the agent's own `notifications/initialized` is not
passed on. A `ping` is answered by the command. In a folder with no project, the command answers as
before (ADR 0083).

**The instructions are kept beside the tools.** Every server writes, with the tools it lists
(`~/.ultrapaint/mcp-tools.json`), the instructions it gives at `initialize`, and the command gives
the kept ones until the server it starts has answered; with nothing kept, its own build's. The
list the command keeps from a server carries the instructions that server gave it.

**Until the server answers, `tools/list` gives the kept list.** An agent plans its first turn from
the tools it is given, so the command offers the tools a server listed last, as it does in a
folder with no project, and once the server answers, asks it for its own list, keeps it, and sends
`notifications/tools/list_changed` when that list differs from the one given. With nothing kept,
`tools/list` waits for the server: an empty list would read as Ultrapaint having no tools.

**A call that needs the server waits for it.** The calls to that project wait for the start the
command began at `initialize`, which is the only one: a server that did not start is said on the
first of them, with the end of its log, as a start that fails always was, and the call after it
starts the server anew.

## Consequences

- `initialize` is answered within the command's own start, about 2 s, whatever the folder holds;
  the time a project's server takes to start moves to the first call, whose client allows it.
- Before a server has started, the command says what it can do for it. The server it starts is
  of the command's own build, so the two agree; a server already running, the desktop app's
  among them, answers `initialize` itself.
- Prompts and resources are not kept: `prompts/list` and `resources/list` wait for the server, as
  calls do.
- The command's own start is unchanged: two Node processes, the server's entry loaded before the
  first answer.
