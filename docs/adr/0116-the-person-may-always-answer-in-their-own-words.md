# ADR 0116: The person may always answer an agent's question in their own words

Status: accepted, 2026-11-23. Amends 0022 (asking the user). Its MCP form rule amended by 0140.

## Context

`ask_user` took `allowOther` per question, and the question card's answer field was read-only
unless the agent set it. Agents mostly left it out, so the person met a field they could not type
in, under options none of which fit, with Decline the only way to say anything else. The card also
drew the question in the heading face, bold and large, which made a long question hard to read.

## Decision

- Every question `ask_user` asks takes an answer of the person's own beside its options. The tool
  no longer has `allowOther`; it sets it on each question, so the form always carries the
  `<id>:other` field (0022) and the old card always takes typing. Options stay the agent's
  suggestions, picked with a click or their number.
- An MCP server's own form keeps the fields it asks for: an answer it has no field for could not
  go back to it, so a question it gives only options for is still answered by picking one.
- The card draws the question in the body face, as the thread's text, not as a heading.

## Consequences

- The tool's definition is shorter by its one flag; prompts that told the agent to set it
  (the Figma import's) say instead that the person may type a name.
- An agent must read a typed answer that is none of its options, as it already did when it set
  the flag.
