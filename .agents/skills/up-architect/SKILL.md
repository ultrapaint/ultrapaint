---
name: up-architect
description: Recommends how to architect a feature — where its seams go, which modules it extends or adds, how each is tested — or judges a design you bring. On request, scans a named area for modules worth deepening. Use when planning how something should be built, or when asked for an architecture review.
metadata:
  pack: epicparty/skills
  version: 0.1.0
---

# Architect

An architect's judgement on demand. Bring a feature, a brief, a story, or a design of your own, and get one **recommendation**: where the seams go, which modules the work extends or adds, what sits behind each seam, and how it is tested — with the alternatives weighed and the decisions only the user can make named as theirs.

It reads what the work touches, not the whole codebase. A scan for refactors happens only when it is asked for, over an area the user names (§ 5).

Two vocabularies carry every recommendation:

- **The architecture's** — [`SEAMS.md`](../up-to-story/SEAMS.md): module, interface, depth, seam, adapter, leverage, locality, and its principles — the deletion test, "the interface is the test surface", "one adapter is a hypothetical seam, two are a real one". Use those terms exactly; never "component", "service", "API" or "boundary" for a module — a framework's own construct, such as a React component, keeps its name.
- **The domain's** — the glossary, which names the modules worth naming, and the ADRs and standards, which hold decisions this skill does not re-litigate. `/up`'s [`DECISIONS.md`](../up/DECISIONS.md) says where they live.

## 1. Frame the question

Name what is being designed, in the glossary's words: the outcome, and — when the user brought one — the design under judgement. Then read what bounds it:

- **The work** — the `/up-explore` brief, the issue and its comments, or the conversation. With no brief and code you have not read this session, run [`/up-explore`](../up-explore/SKILL.md) first. When the request already names the design and the files it lands in, its locate step (§ 3) is enough.
- **The modules it touches** — each one's interface, its callers, and the tests at its seam today.
- **The rules in the area** — the ADRs and the project standards the agent files route those paths to. A project with none of these gets one line saying so.

Done when you can say, in one sentence each, what the work must do, which modules it lands in, and which rules bind it.

## 2. Weigh the options

Most features have two or three honest shapes. Lay them out side by side:

- **Extend or add.** Does the behaviour belong behind an existing module's interface, or does it earn a module of its own? Run the **deletion test** on any new module: if deleting it would only move complexity back into its callers, it earns its place; if the complexity would vanish, it is a pass-through.
- **The seam.** Where the feature is tested and swapped — the highest existing seam first, a new one only where something varies across it. Name each dependency's category from `SEAMS.md`, since that decides the adapters and how the seam is tested.
- **The interface.** What callers must know — every invariant, ordering and error mode, not only the signature. Where its shape is the open question — several callers, no obvious entry point — follow [`DESIGN-IT-TWICE.md`](./DESIGN-IT-TWICE.md).
- **The rules.** A shape that contradicts an ADR or a standard stays on the table only when the friction is real enough to reopen the rule, and the conflict is said out loud — _"contradicts ADR 0007, but worth reopening because…"_.

A design the user brought is one of the options, judged by the same tests. Say what holds in it, what to change and why, before offering another.

Done when every option names its modules, its seams and its cost, and each rejected one has the reason it lost.

## 3. Recommend

One recommendation, opinionated — the user wants a strong read, not a menu. Where parts of two options combine well, recommend the hybrid.

```md
## Architecture: {the feature}

**Your design:** {only when the user brought one: what holds, what to change, and why}

**Recommendation:** {one or two sentences: the shape}

| Module | Change | Interface | Seam and tests |
| --- | --- | --- | --- |
| {the glossary's name where it has one, else the code's} | extend / new / deepen | {what callers must know} | {seam, dependency category, adapters, the test level} |

**Why this shape:** {leverage and locality, in SEAMS.md terms}

**Rejected:** {each option and the reason it lost}

**Decisions for you:** {each call that is the user's to make, with the answer you recommend}

**Worth an ADR:** {a decision that passes DECISIONS.md's three-part test, or "none"}
```

Done when every module the work touches has a row, and every call that is the user's sits under **Decisions for you**.

## 4. Hand on

The recommendation is advice until the user takes it.

- **Decisions still open** — ask the items of **Decisions for you** one at a time, the way `/up` `## Working rules` says, each with its recommendation first. [`/up-grill`](../up-grill/SKILL.md) only when the user asks, or an answer opens decisions you could not list.
- **Agreed** — [`/up-to-story`](../up-to-story/SKILL.md) writes the story with these seams, and names them as agreed. An issue that already exists takes them into its `## Implementation Decisions` and `## Testing Decisions`.
- **An ADR the user accepts** — written per [`DECISIONS.md`](../up/DECISIONS.md#writing-an-adr): here, once the user accepts it.

Done when the user has answered **Decisions for you**, and taken the recommendation or changed it.

## 5. Scan an area, on request

<!-- upstream: mattpocock/skills skills/engineering/improve-codebase-architecture/SKILL.md -->

When the user asks for refactors rather than a design — "where should we deepen X", "review the architecture of Y" — scan **the area they name**. With no area named, ask for one — unless the whole codebase is small enough to read in one sitting: then scan it, and say so.

**Weight what changes.** Deepening pays off by making future changes easier, so walk back a good stretch of the area's history (`git log --oneline -- <area>`) for its **hot spots**, and let them pull your attention first.

Dispatch a subagent with a fresh context to walk the area — brief it with the area, both vocabularies and the questions below, and have it return candidates — or walk it yourself where subagents are unavailable. It notes where it feels **friction**:

- Understanding one concept means bouncing between many small modules.
- A module is **shallow** — its interface nearly as complex as its implementation.
- Pure functions were extracted for testability, but the real bugs hide in how they are called — no **locality**.
- Tightly coupled modules leak across their seams.
- Code is untested, or hard to test through its current interface.

Apply the deletion test to each suspect, and keep the ones where deletion would concentrate complexity. A bug the walk turns up goes under **Found in passing**, for [`/up-diagnose`](../up-diagnose/SKILL.md). A scan that finds nothing worth deepening says so, and writes no report.

Report the candidates as one self-contained HTML file outside the checkout — `<dir>/architecture-review-<timestamp>.html`, where `<dir>` is the session's scratch directory where the harness names one, else `$TMPDIR`, `/tmp`, or `%TEMP%` on Windows. Open it where there is a desktop, and give the user the absolute path. [`HTML-REPORT.md`](./HTML-REPORT.md) has the scaffold, each card's fields, the diagram patterns and the tone. End with a **top recommendation**, propose no interfaces yet, and ask which candidate to explore.

The chosen candidate then runs § 1 to § 4 as a design. **A candidate the user rejects with a load-bearing reason** earns an ADR offer — _"Want me to record this as an ADR, so later reviews do not suggest it again?"_ — when a future reviewer would need that reason to avoid re-suggesting it.

Done when the report is open, every candidate has its card, and the user has the question.
