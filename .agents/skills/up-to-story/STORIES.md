# Stories

Every issue the `up-*` skills write or read is a **user story**: one user-visible outcome, written from the side of whoever benefits, with enough decided that someone can build it and someone else can tell whether it happened.

This file says what goes *in* an issue. The project's own rules add to it — its title shape, its label axes, its domain roles — and win where they differ.

Treat the backlog as a production backlog. An issue is read months later by someone who was not in the conversation that produced it — often an agent with no context beyond the text. Write for that reader.

Before writing or editing one, read the neighbouring issues in the same area. The backlog's existing shape is the pattern to match, and it carries decisions this file cannot.

The label names below — the triage, discovery, epic and ready labels — are roles. The **Labels** setting (`/up` `## Settings`) maps each role to the project's own label.

## The unit

One issue is **one goal**: the outcome someone asked for, carried whole — backend, frontend, tests and translations, every layer and every edge that reaching it takes. Shippable on its own and worth shipping on its own. A story is as large as its goal and never smaller: a large story reads as one piece of work on the tracker, where its fragments read as noise around the work that matters.

- **Written from the beneficiary's side.** A story names who gets something and what they get. The implementation is how, and it comes later in the body.
- **In domain vocabulary.** Use the terms from the project's glossary — `/up`'s [`DECISIONS.md`](../up/DECISIONS.md) says where it lives — capitalised as the domain capitalises them. An issue that invents its own words for existing concepts is a rename waiting to happen.
- **Not a task list.** Tasks belong to the PR that delivers the story. An issue whose body is a checklist of files to touch has skipped the part that makes it a story.
- **Independent, or explicitly blocked.** If it needs another issue first, say so in `## Blocked by` and wire the tracker's native dependency.

## Four shapes

Which shape an issue takes depends on how settled it is, not on who is writing it.

| Shape | Marked by | When | Body |
| --- | --- | --- | --- |
| **Epic** | the epic label | An outcome made of several goals, whose stories aren't known yet | `## Outcome` · `## Problem` · `## Stories` (checklist, each a future issue) · `## Success signals` · `## Out of scope` · `## Open questions` |
| **Story** | the default | The work is understood well enough to build | [The story body](#the-story-body) |
| **Child story** | a parent link | One goal of an epic or story that is still open | `## Parent` · `## What to build` · `## Acceptance criteria` · `## Testing Decisions` · `## Blocked by` |
| **Discovery** | the discovery label | The outcome is wanted but the decisions aren't made | `## Context` · `## Scope (to be decided)` · `## Acceptance (draft)`, and the open decisions listed as questions |

A discovery ticket is a story that admits it isn't ready. It becomes a story when its decisions are answered — that rewrite is expected, and legitimate right up until the work ships.

A **child story** is a full story in every way that matters: its own title, its own labels, its own PR, demoable on its own. What it does not do is repeat its parent. The problem and the solution are stated once, on the parent, and the child links to them. That is the one place an issue may depend on another issue for its meaning, and it is safe precisely because the parent is open: both are live, and a reader following the link finds a document that is still being maintained.

**This is not the refinement case.** A refinement of a *shipped* story restates it in full, because the original is frozen and can no longer be corrected. A child of an *open* parent links instead. The distinguishing question is the same one everything else here turns on: has the work landed on the default branch?

Epics and discovery tickets are written by hand. No form or skill can ask its way to either shape.

## The story body

The default shape, in this order:

<story-template>

## Problem Statement

The problem the user faces, from the user's perspective: what someone cannot do today, or what goes wrong when they try. Cite the code that makes it true (`path/file.ts:42`), so a reader can check the premise instead of trusting it.

## Solution

The solution to that problem, from the user's perspective. Still no implementation.

## User Stories

A LONG, numbered list. Each one:

1. As a &lt;Role&gt;, I &lt;capability&gt;, so that &lt;outcome&gt;

<user-story-example>
1. As a Shop Owner, I see which orders are still unpaid, so that I know whom to remind before I ship
</user-story-example>

Cover the whole surface of the change, edges included: what someone without permission sees, what happens when the thing is absent, what an existing user experiences after it ships. Roles are domain roles.

## Implementation Decisions

The durable decisions:

- The modules built or modified, and the interfaces that change
- Schema changes and API contracts
- Architectural choices, and the alternatives rejected with the reason
- Technical clarifications the developer gave

Keep file paths and code snippets out — they go stale fastest. Exception: where a prototype produced a snippet that encodes a decision more precisely than prose can — a state machine, a reducer, a schema, a type shape — inline it, trimmed to the decision-rich part, and note that it came from a prototype.

## Testing Decisions

- The externally observable behaviour to test
- The level each behaviour is tested at, from the **Test levels** setting where it is set, and in which module
- The prior art to copy from: the tests in this area that already work

## Out of Scope

Each boundary, and why it sits outside. This section is what stops scope creep from being argued in a PR review.

## Blocked by

Issue references this story waits on, matching the tracker's native dependencies. Omit the section when there are none.

</story-template>

Add `## Further Notes` after these only when something genuinely fits nowhere above.

**Completion criterion:** every accepted requirement appears in a user story, an implementation decision, a testing decision, or an out-of-scope note. Anything that appears nowhere is an unrecorded decision, and it will be re-litigated in review.

## Writing the story sentence

`As a <Role>, I <capability>, so that <outcome>.`

- **Role is a domain role**, not "a user" as a catch-all. If every story starts `As a User`, the roles haven't been thought about.
- **Capability is what the person does**, present tense, concrete enough to demo.
- **`so that` is the value, and never a restatement of the capability.** "so that I can upload an avatar" after "I upload an avatar" says nothing; "so that people recognise me in a list" is the reason the work is worth doing — and the thing to check the built feature against.

Each story is a sentence someone can hold a running build against and answer yes or no. In the **story** shape that is the acceptance criteria — it plus `## Testing Decisions`, with no separate section. A **child story** is the exception, and carries `## Acceptance criteria` explicitly: it has no `## User Stories` section for the criteria to be implied by, and it is the unit somebody picks up and builds.

Cover the edges as their own stories, not as caveats: what the person without permission sees, what happens when the thing is absent, what an existing user experiences after the change ships.

## Bugs

A bug is a story about behaviour that already exists and is wrong. Same title rule, the bug type, and a body that gives:

- **Observed** — what happens, on which surface, for which role.
- **Expected** — the behaviour the product promised. If a shipped issue promised it, link it.
- **Reproduction** — steps, the failing test, or a link to the error or the session that shows it.
- **Scope** — which surfaces are affected.

## Enabler stories

Chores, refactors and infrastructure are still stories — the beneficiary is a developer, an operator, or the business, and the value goes in the `so that`. Write `As a developer, I ..., so that ...`, and don't contort a dependency bump into a customer-facing sentence. What is not acceptable is an enabler with no stated value: if the `so that` can't be written, the work needs justifying before it needs building.

## Ready

An issue earns a ready label — for an agent, or for a human — when all of this is true; nothing here is a formality:

- The title carries a scope from the **Scopes** vocabulary, where the project uses scopes.
- Every label axis the project defines is set, and the triage label is gone.
- The problem is stated with evidence, not asserted.
- Every part of the surface is covered by a numbered story.
- Testing decisions name a level and prior art.
- Out of scope is explicit.
- Blockers are linked and the open ones are known.
- **No decision is left implicit.** A question the body raises and does not answer means the issue needs info or is a discovery ticket, not ready.

Ready for an agent specifically means an agent can deliver it with no further conversation. If you'd expect a question back, it isn't ready.

## Done

The story is done when the change is on the default branch, every numbered story reads true against the shipped product, and the tests named in `## Testing Decisions` exist and run in the project's gate. The merged PR closes the issue.

## Frozen once live

An issue records what was asked and what shipped for it. That record is only worth reading if it is not rewritten afterwards.

**Before the work is live** — nothing merged to the default branch for it — the body is working material. Sharpen it, split it, rescope it, rewrite the acceptance. Refining a story nobody has built is the point of having it written down.

**Once the delivering change lands on the default branch, the body is frozen.** Do not edit a shipped issue to reflect what changed later. Each of these is a **new issue**:

| What happened after it went live | What you do |
| --- | --- |
| Scope grew or shrank | New issue |
| Core logic changed | New issue |
| Real acceptance turned out different from what shipped | New issue |
| Polish, follow-up, or a bug found later | New issue |

Editing a shipped story rewrites history. The issue stops describing what was actually built and reviewed, the PR that closed it no longer matches its own issue, and the trail from "why does the product behave like this" back to "who asked for it, when, and against what acceptance" breaks. Two stories in sequence are readable; one story silently overwritten is not.

Still fine on a closed issue: labels, board status, a title scope that was wrong, links, and comments — metadata about the story, not the story. If a shipped body is factually wrong about what shipped, **correct it in a comment**, never in the body.

### The refinement issue

- A normal issue with its own labels — an improvement when it moves the behaviour further, a bug when live behaviour doesn't match the story that shipped.
- **Restates the story in full.** Never a diff against the original; a reader must not need the old issue to understand what is being asked now.
- Names its origin in the body: `Refines #<n>`.
- Gets a pointer back: comment `Refined by #<m>` on the original, so the trail reads in both directions.

A feature that keeps moving therefore has a chain of closed stories, one per delivered increment, and that chain is the history of the feature.

## Splitting

**One goal, one story, one PR.** A story splits on one condition: it carries a second goal — an outcome that would be asked for on its own, and would be worth shipping if the first never existed. Nothing else splits it. The layers stay together, because neither half of "backend for X" and "frontend for X" is worth shipping alone. The size of the diff stays together, because bigger means more behaviour per issue, never vaguer. A part still waiting on a decision holds the story until it is decided, because the decided half shipped alone is a fragment. A surface the numbered stories missed becomes one more numbered story on the same issue.

A split makes siblings, one goal each, or promotes the parent to an epic whose `## Stories` checklist names them. Every child carries its parent link and its native dependencies, so the set still reads as one outcome. [`SPLITTING.md`](./SPLITTING.md) is the mechanics.

Two shapes look like a split and are not:

- **A landing in stages.** A schema change on live data widens, backfills and narrows, and the narrow can only deploy after the widen has. That is one story with a PR per stage: `Part of #<n>` on every stage but the last, `Closes #<n>` on the last. The story stays open between stages, and the next stage starts from `/up-implement` on the same issue.
- **A refactor with a wide blast radius.** Expand, migrate and contract are the commits of one PR, not a child issue each. Under a rebase or merge-commit merge each stage reaches the default branch as its own commit, so the stages read there without a child issue each; under a squash, the PR body names them in the commit it becomes (**Merge strategy**, `/up` `## Settings`).
