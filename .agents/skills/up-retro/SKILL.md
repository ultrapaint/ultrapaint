---
name: up-retro
description: Looks back over a session — the current one, a named one, or the stories a /up-deliver run parked — for what would make the next one go better, and proposes each fix on the rung that holds it.
disable-model-invocation: true
metadata:
  pack: epicparty/skills
  version: 0.2.0
---

# Retro

<!-- upstream: mattpocock/skills skills/engineering/retro/SKILL.md -->

A retrospective improves the agent's **environment**, not the code it wrote: what the next session can find, what checks it, what it is told. One retro ends in a ranked list of proposals, and each one the user accepts leaves as a story or a branch.

A retro reads until § 4, and every proposal is the user's to take.

## 1. Read the sessions

The argument names what to look back on: a thread, a transcript, a PR, a story, or a `/up-deliver` run. With none, the current session. After a `/up-deliver` run, the stories it **parked** come first, because something went wrong there, then about one in five of the rest.

Read **primary sources**: the transcript, where the harness keeps one on this machine (Claude Code under `~/.claude/projects/`, Codex under `~/.codex/sessions/`); the PR's checks, review threads and findings; the issue's comments; the commits. A summary of a session — a hand-off document, a report — is a secondary source: use it where it is all there is, and say so.

In each session, mark the **moments** it went slow, wrong or expensive: a correction from the user, a red check, a review finding, a re-route, a park, a long search for something that had an address, an expensive tool call, a guess at a fact the agent could not reach.

Done when every session named is read, and each moment is listed with its citation — a transcript line, a PR thread, a commit.

## 2. Find each moment's cause

For each moment, ask which part of the environment would have prevented it. The lenses:

- **Navigation** — the agent took long to find something: a pointer the agent files lack, or a hidden dependency between files that nothing names.
- **Automated checks** — a mistake a check could have caught. Read the repo's own check scripts and CI workflow first: a check that exists but is unwired or silently broken is the finding, not a new one. A repo with no **guardrail** — no CI job or hook running its lint, typecheck and tests — is a finding by itself.
- **Review** — a mistake [`/up-code-review`](../up-code-review/SKILL.md) let through: a standard to add, sharpen or drop. Standards belong to the review, which reads a diff with room to spare; the implementer is the one under context pressure.
- **Agent files** — `AGENTS.md` or `CLAUDE.md` carrying steering that belongs in a standard or a check, or lines that change nothing (`/up-writing-for-agents` `## Pruning`, its no-ops).
- **Tool cost** — a call that read far more than it needed, where a narrower command, a script or a flag would do.
- **Information access** — a fact the agent needed and could not reach: dev-server logs, a read-only view of a service, a doc.
- **The pack** — a step of an `up-*` skill that misled, or a setting that was missing. This fix is not the project's to make: name the skill and the step, as a finding for the pack's maintainers.

Done when every moment has a cause on one lens, or is named as nobody's fault — a judgement call that went the other way, a flake already tracked.

## 3. Put each fix on its rung

Give each cause a fix on the highest rung that holds, per [`/up-writing-for-agents`](../up-writing-for-agents/SKILL.md) `## Encode the lesson`: the shape of the code, a type, a lint whose error names the fix, a test, and a document last. A **mechanical** mistake — a banned API, an import shape, a file in the wrong place — always gets a check. Prose is for **judgement calls**, and goes where it is read: the review's standards for what a review should catch, an agent file or a skill for what the implementer needs while working.

Weigh each fix as `/up` `## Working rules` says: how often its moment happens and whom it reaches, what it costs to build and keep, what it can break, and your verdict.

Done when every cause has a fix, its rung, where it lives, and a verdict.

## 4. Report, and act on the user's word

Report in `/up` § 5's shape. **Details** is one table, worst first:

| Moment | Cause | Fix | Rung | Where | Verdict |
| --- | --- | --- | --- | --- | --- |

Each moment carries its citation. **Your turn** lists the fixes worth making, numbered, for the user to accept, amend or drop. Findings for the pack sit under their own heading, for the user to pass on.

On the user's word, each accepted fix becomes work like any other: one that needs no decision and fits one commit — a lint rule, a pointer, a pruned line — goes through `/up-implement` → `/up-to-pr` → `/up-ship` as small and obvious; anything larger is a story through [`/up-to-story`](../up-to-story/SKILL.md). Several small fixes for one area can share a branch when they share a goal.

Done when the user has the ranked list, and each accepted fix is on a branch or on the tracker.

## Guardrails

- **A retro reads.** Nothing is written before § 4 and the user's word.
- **Every row cites its moment.** A cause without a moment it caused is a preference.
- **Redact** every key, password and piece of personal data quoted from a transcript or a log.
- **The fix goes on the environment, never on the session.** A rule that names one session's case — this file, this test — is a patch on the past, not a lesson. State it as the general rule it is an instance of.
