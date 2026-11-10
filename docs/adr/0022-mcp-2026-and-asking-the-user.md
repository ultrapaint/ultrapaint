# ADR 0022: The editor speaks MCP 2026-07-28, its tools cost half as much to carry, and an agent waits for the user's answers

Status: accepted, 2026-10-02. Amends 0014 (the protocol, the tools' definitions, `ask_user`) and
0016 (questions about a Figma file are answered within the turn).

## Context

A CLI in place of the MCP server was considered first. Its gain would be reach (any shell, a
person) and not carrying tool schemas in every request; its costs were JSON through shell quoting,
a picture written to a file and read back, a permission prompt per call and a transcript that sees
only "execute". What the tokens actually are decided it: what an agent carries is each tool's
name, description and input schema — Codex leaves the output schema out (`#[serde(skip)]`), and
reads a result's `structuredContent` in place of its text, not as well — so the cost was ours to
cut, whichever transport. Claude Code loads the editor's tools on demand through its tool search;
Codex carries all of them on every turn.

Measured on the wire, the 34 tools took 28,583 characters an agent reads, about 7,900 tokens:
optional parameters as unions with `null`, numbers that also admitted `"NaN"` as a string, the
page parameter's sentence repeated in a dozen tools, every JSON parameter describing every JSON
value, and `write_design_system` carrying the design system's whole JSON Schema (2,000 tokens,
used by `/init` alone).

MCP 2026-07-28 makes the protocol stateless (no `initialize`, no session id: a server restart
under `--dev` no longer strands an agent) and lets a tool answer "input required" with a form,
which the agent puts to its client and answers by calling the tool again. Effect 4.0.0 has it.

## Decision

**The protocol.** The server offers 2026-07-28 first, then 2025-11-25 and 2025-06-18; 2025-03-26
is dropped. Both built-in agents negotiate 2026-07-28, checked with real sessions
(`apps/server/spike/mcp-agents.ts`, which the server's "MCP: thread … speaks …" log line serves):

- Claude Code from `@agentclientprotocol/claude-agent-acp` 0.79, whose bundled Claude Code turned
  it on by default; the built-in configuration asks for `^0.85.0`. (Since 2026-11-10 it asks
  for `^0.95.0`, the version the desktop app bundles; a test in the desktop app holds each
  bundled adapter inside the range the command asks npx for.)
- Codex only behind its `mcp_2026_07_28` flag, off by default and marked under development.
  codex-acp merges the `CODEX_CONFIG` environment variable into every session's configuration,
  and the built-in configuration sets the flag there. Without it Codex asks for 2025-06-18, which
  is why the two older revisions stay.

The user's own `claude` and `codex` are not involved: each adapter brings its own, so the minimum
versions are pinned in the launch configuration and `npx` fetches them.

**The tools' definitions.** Optional parameters are `Schema.optionalKey` (a plain property),
numbers are `Schema.Finite` (which also keeps their bounds, lost before), JSON parameters are
`Schema.Unknown` validated by the handler, the page parameter says less, and the descriptions say
what the tool does and not what the briefing explains. What they said about canvases and variants
is in `get_context`'s `guide`, read once by an agent without a briefing. `get_document_format`
gives the design system's schema with `kind: "design-system"`. 14,860 characters, about 4,100
tokens; a test keeps them under 16,000. `read_page` takes `node`, to read one subtree of a big
page.

**Asking the user.** `ask_user` answers "input required" with a form when the agent speaks
2026-07-28 and its client can show forms. For a thread the client is the editor: it advertises
`elicitation.form` over ACP (SDK 1.6) and draws `elicitation/create` as the question card it
already had, now able to show any MCP server's form — options, several options, typed text,
numbers, yes or no, optional questions, descriptions. The card is answered while the agent is
working, can be declined, and says so when the agent stops waiting (the turn is cancelled, the
session ends). The answers go back through the agent's tool call: no prompt, no ended turn.

A question with options and an answer of the user's own has no field kind in the form, so it is
two fields, `<id>` and `<id>:other`, put back together by the card. Option descriptions travel in
the titled options; Claude Code drops them on the way.

An agent that cannot wait still gets the old card, whose answers are sent as the next prompt: an
older revision, a client without forms, or Codex, which under full access (codex-acp's
`agent-full-access`, approvals `never`) declines every form before the editor sees it unless its
client declares OpenAI's form-input extension, which codex-acp does not yet. The tool tells that
decline from the user's by `requestState`: it carries how many cards the thread had shown when
the form went out, and a decline with no card shown since sends the questions to the old card,
and every later `ask_user` of that thread straight there.

## Measured

`docs/feature/benchmarks/2026-10-tool-definitions/`: the four tasks, rewritten for design
documents (they still asked for `.tsx` pages and could not pass since 0015), two runs each, Claude
Code on Opus 5 and Codex on 6 Astra, on the same commit's protocol with the definitions before and
after.

Every run of both arms came out right. Per run, on average:

| | calls | tokens counted |
|---|---|---|
| Claude Code, before | 13.0 | 496k (467k cache reads) |
| Claude Code, after | 13.3 | 470k (447k cache reads) |
| Codex, before | 22.5 | 35.3k |
| Codex, after | 20.5 | 33.7k |

So the cut is about 5% of what Claude Code spends on a task and no change in how it works: it
was already loading the tools on demand. Codex makes two calls fewer, within the spread of two
runs. Codex's counts leave out what Claude Code counts as cache reads, as in 0014, and are not
comparable with Claude Code's. What the cut saves for certain is context on every turn of
Codex, and of any agent that loads every tool, rather than calls.

The bench caught a fault the unit tests had not. An array parameter without `items` — the
operations of `apply_operations`, once `Json` gave way to `Schema.Unknown` — is read by Codex
(`sanitize_json_schema`) as an array of strings, and every call it made was refused. The
operations are objects now, and the budget test checks every array says what it holds. The runs
above are after that fix.

Two things in the bench changed with it. The `router-link` check accepts a link to the page file
that serves `/pricing`, which 0021 made a link like any other, and the bench answers a question
card with each question's first option: with `ask_user` waiting within the turn, an agent asks
whether to make the page `/pricing` would lead to, and a card nobody answers held one run for
eight minutes. `router-link` was run again in both arms with both changes.

The numbers in 0014 measured the old tasks and are not comparable with these.
