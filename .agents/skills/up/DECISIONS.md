# Decisions

Where a decision the work makes is written down, and how the `up-*` skills read the project's domain documents. The project's own rules — its domain doc, its ADR layout — add to these and win where they differ.

## Before exploring, read these

- **The glossary** — `GLOSSARY.md` at the root, or a `GLOSSARY-MAP.md` that points at one glossary per context. A project that already names them `CONTEXT.md` and `CONTEXT-MAP.md` keeps those names. Read each one relevant to the topic.
- **The ADRs** — `docs/adr/`, and in a multi-context project the context's own ADR directory beside its glossary. Read the ones that touch the area you are about to work in.

Where any of these does not exist, **proceed silently**. Their absence is not a finding, and creating them upfront is work nobody asked for: they are created lazily, when a term or a decision actually gets resolved — [`/up-grill`](../up-grill/SKILL.md) writes them as a session settles them, in the formats below.

## Where a decision goes

Three homes, widening in scope. Pick by **how long the decision binds**, not by how much detail it carries.

| The decision | Home |
| --- | --- |
| Shapes the increment being built, and nothing beyond it | The story's `## Implementation Decisions` |
| Binds code outside its own story, in one area | An ADR |
| Binds more than one area, or is applied repeatedly | A project standard |

**The story is the default.** Most decisions made while building are answers to "how do we do this one", and they belong in the issue that asked for the work. Writing an ADR for one of those duplicates the story into a file nobody reads.

**An ADR earns its file when someone will need the decision while working on something else.** The cheap proxy: would a code comment cite it? A function that refuses to do the obvious thing needs a reason with a stable address, and `// (ADR 0006)` is that address.

The reason a live constraint cannot stay in the story is lifetime. **A story is frozen once its work lands on the default branch** — later changes become new issues, so a feature that keeps moving leaves a chain of closed stories, and a constraint parked in one of them can only be reconstructed by reading the whole chain and guessing which parts still hold. **An ADR is live**: it is superseded in place by a named successor, so there is exactly one current answer.

**A standard is an ADR that outgrew its context.** When a second area needs the same rule, the ADR stays as decision history and the rule moves to the project's standards, which become binding.

Three things that are **not** ADRs: a decision that only shapes its own increment (the story), a restatement of an existing standard (point at the standard), and a plan for work not yet done (an issue).

## Writing the glossary

When a term is resolved, write it into the glossary right there — never batched for later — in the shape of [`GLOSSARY-FORMAT.md`](./GLOSSARY-FORMAT.md).

## Writing an ADR

<!-- upstream: mattpocock/skills skills/engineering/domain-modeling/ADR-FORMAT.md -->

**Offer an ADR only when all three hold:** the decision is **hard to reverse**, it is **surprising without context** — a reader of the code would wonder why — and it is **the result of a real trade-off**, with genuine alternatives. Missing any one, skip it: an easy decision is reversed, an obvious one is never wondered about, and one with no alternative records nothing.

What qualifies: the architecture's shape; how contexts integrate; a technology choice with lock-in — not every library, only the ones that take a quarter to swap; a boundary or scope decision, the explicit noes included; a deliberate deviation from the obvious path; a constraint the code cannot show, such as a compliance rule or a partner's response-time contract; and a rejected alternative whose rejection is not obvious, so nobody proposes it again in six months.

ADRs live in `docs/adr/` as `0001-slug.md`, `0002-slug.md`, and so on — the next number is the highest in the directory plus one. Create the directory with the first ADR.

```md
# {The decision, stated as a claim}

{One to three sentences: the context, what was decided, and why.}
```

That can be the whole ADR. Keep it short: one to three paragraphs.

- **The title states the decision as a claim**, present tense — "Blocking severs relationships and never confirms itself", not "Blocking behaviour". The title is what a reader scans a directory for.
- **The body gives the decision, what it rules out, and the cost accepted.** The cost is the part that stops the decision being reopened every six months.
- **`## Considered options` only when a rejected option will be proposed again.** Most decisions do not need it. `## Consequences` only when a downstream effect is not obvious, and a `Status` line (proposed, accepted, deprecated, superseded) only where decisions get revisited.
- **An ADR number is its identity.** Numbers run per directory and are never reused, so a new ADR takes the next free number in the directory it lands in.
- **Supersession is stated by the successor**, naming what it replaces and what still stands. Add a line to the superseded ADR pointing forward; leave its body intact as history.
- **Qualify a citation that crosses directories.** Where several ADR directories share one numbering space, `ADR 0006` names several decisions. Inside a context's own tree a bare number reads as that context's ADR; a citation from outside it takes the context's prefix.

## Use the glossary's vocabulary

When your output names a domain concept — an issue title, a refactor proposal, a hypothesis, a test name — use the term as the glossary defines it. Do not drift to synonyms the glossary avoids.

A concept the glossary lacks is a signal: either you are inventing language the project does not use (reconsider), or there is a real gap: add the term when the user settles it, or note it in your report when they are not there to.

## Flag ADR conflicts

When your output contradicts an existing ADR, surface it rather than silently overriding it:

> _Contradicts ADR 0007 (match-scoped disqualification) — but worth reopening because…_
