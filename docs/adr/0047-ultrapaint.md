# ADR 0047: The names, before the first release

Status: accepted, 2026-11-02.

## Context

The tool is to be released as open source first, so what has to be its own is the command people
type, the npm name, the GitHub organisation, and a domain. Its name was written the way a machine
reads it, `ultrapaint`, in prose too, and nothing said how it is written where a person reads it,
or which names the release takes.

## Decision

The tool is **Ultrapaint** wherever a person reads it: prose, window titles, the desktop app, the
editor's mark (`UP`). It is `ultrapaint` wherever a machine reads the name:

| Where | Name |
|---|---|
| Command, npm package, files, keys, tags, the MCP server | `ultrapaint` (agents see `mcp__ultrapaint__*`) |
| Environment variables | `ULTRAPAINT_*` |
| Workspace packages | `@ultrapaint/*` |
| JavaScript identifiers | `ultrapaint` (`window.ultrapaintPlatform`, `__ultrapaintRequire`) |
| Repository | `github.com/ultrapaint/ultrapaint` |
| Site | ultrapaint.dev |
| Desktop app id, URL scheme | `dev.ultrapaint.desktop`, `ultrapaint:` |

"Paint" is what a browser does with an interface, and what the user does to theirs.

## Consequences

- A name a machine reads does not change with how prose writes it: `ultrapaint` stays lowercase
  in code, files and commands.
- Nothing names the organisation that owns the repository but its URL.
