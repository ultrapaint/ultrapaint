---
name: up-triage
description: Judges one existing issue — still viable, decided enough, labelled right — and ends in one verdict. Use when asked whether a story is still worth building, is decided enough to build, or is mislabelled.
metadata:
  pack: epicparty/skills
  version: 0.1.0
---

# Triage

One issue, one **verdict**. Triage reads a story the way the next agent will — text and comments only, no memory of the conversation that produced it — then tests that text against the default branch as it is today, and says what should happen to it next.

It answers three questions, in order: is the outcome still wanted and still true, are the decisions in the body decided or merely written down, and do the labels say what the evidence says. The verdict follows from the answers, and every line of it cites something.

Triage reads until § 7. The labels and the body are the user's to change, and the verdict is a recommendation until they take it.

Labels are named here by **role** — the triage, info, discovery, ready and won't-fix labels — and the **Labels** setting maps each role to the project's own label and defines its axes.

## 1. Read the record

Read the **Tracker** setting now, per [Settings](#settings): every triage ends in a change to the issue, so a missing one is asked for here. With **None**, stop: triage judges an issue, and the project keeps none. Say so.

Read the issue with its comments, labels, assignees, dependency edges and linked PRs — on GitHub, `gh issue view <n> --comments`, with the edges from [`SPLITTING.md`](../up-to-story/SPLITTING.md) `## GitHub mechanics`. Where the project keeps a board, read the issue's status on it too. Note who filed it and when: age is evidence in § 2.

Then restate the outcome in one or two sentences, in the domain's own words from the project's glossary — `/up`'s [`DECISIONS.md`](../up/DECISIONS.md) says where it lives. A story you cannot restate is one you cannot judge.

Done when you hold the body, every comment, the labels, the board status where there is a board, and the dependency edges, and the user would recognise their ask in your restatement.

## 2. Test the premise

The body asserts a problem. Check it against the default branch today, on three fronts:

- **Still true.** Read the code the `## Problem Statement` cites; where it cites none, find the code that makes the problem real. A premise the codebase no longer bears out is the most common way an old story dies.
- **Not overtaken.** Search closed issues and merged PRs for the same work, with the story's own nouns — on GitHub, `gh issue list --search "<keywords>" --state all` and `gh pr list --search "<keywords>" --state merged`. A closed hit that delivered the outcome closes this one; an adjacent hit is context.
- **Still consistent.** The ADRs in the area, the glossary's vocabulary, and any story shipped since. A story that contradicts a later decision is superseded, however good it looked when filed.

Read the blockers too. A blocker closed as *not planned* takes its dependants with it unless something says otherwise.

Done when each front has a finding with a citation — a path, an issue, an ADR — and you can say *viable*, *overtaken* or *superseded* with the evidence beside it.

## 3. Grade the decisions

Walk the decisions the body's shape carries ([`STORIES.md`](../up-to-story/STORIES.md) `## Four shapes`): in a story, `## Solution`, `## Implementation Decisions`, `## Testing Decisions` and `## Out of Scope`; in a discovery body, each open question, missing until it is answered; in a bug, the `## Bugs` fields — observed, expected, reproduction — each present or missing. Grade every decision:

| Grade | Meaning |
| --- | --- |
| **held** | Carries its reason, or names the alternative it rejected. |
| **thin** | Asserted with no reason, or with a reason the default branch has since falsified. The decision taken without much thought. |
| **missing** | A question the body raises and does not answer, or a surface no numbered story covers — the person without permission, the thing that is absent, the existing user after the change ships. |

Then hold the whole against the **Ready bar** in [`STORIES.md`](../up-to-story/STORIES.md) `## Ready`, and the **one-goal** test in [`/up-to-story` § 2](../up-to-story/SKILL.md#2-hold-it-to-one-goal) — a second outcome that would be asked for on its own.

A question the code, an ADR or a shipped story already answers is a fact, not a decision: cite the answer and grade it **held**.

A thin decision is not yours to re-make. Put a recommendation beside it, with its reason, and leave the choice where it belongs.

Done when every decision in the body carries a grade, every gap against the Ready bar is named, and the size question has an answer.

## 4. Check the labels

Read the **Labels** setting now, per [Settings](#settings), and **Scopes** when it is set. Then check each axis the **Labels** setting defines, current against what the evidence says:

- **The title** carries a scope from the **Scopes** vocabulary, where the project uses scopes. An axis that names the same thing as the scope — a product, a layer — agrees with it.
- **A priority axis** reads off what the setting says each value means, and off the neighbours: what else in this area sits at that priority, and what is blocked on this one. A low priority that a higher one waits on is mislabelled.
- **A type axis** matches what the body actually changes.
- **The process label** matches the verdict you are about to give. Where the project keeps a board whose status follows the labels, the status matches them too.

A story still carrying the triage label gets every axis proposed here, and dropping the triage label is part of the delta. A label the verdict needs and the tracker lacks is named in the report, never created here — only the **Labels** setting's own step offers to create labels, when it is first answered. With the **Labels** setting at **None**, this step checks the title alone.

Done when each axis has a current value, a proposed value and a reason — or reads *unchanged*.

## 5. Give the verdict

Take the first row that matches:

| Verdict | When | It leads to |
| --- | --- | --- |
| **Close** | Overtaken, superseded, or the premise is gone | Close the issue with the reason; the won't-fix label where it was declined rather than done |
| **Needs info** | A fact only the reporter holds, and nothing can be judged without it | The info label, and the question as a comment |
| **Split** | Carries a second goal | [`SPLITTING.md`](../up-to-story/SPLITTING.md), then triage each child |
| **Grill** | Decisions that turn on each other, so tightly that no list of questions can be written up front | The discovery label; the decisions in § 6 seed [`/up-grill`](../up-grill/SKILL.md), on the user's word |
| **Settle** | Thin or missing decisions, each standing alone | The questions, listed in the report with your recommendation beside each one you can defend, then asked one at a time (`/up` `## Working rules`); on their answers, the body is edited to carry them, and the ready label follows when the bar then passes |
| **Ready** | Passes the Ready bar | The ready label for an agent or for a human; the labels are the whole change |

The rows sit in this order because each makes the rows below it moot: nothing on a dead story is worth grilling, and a story that is really two cannot be graded as one.

Done when one verdict is named, and each row above it has been ruled out in a sentence.

## 6. Report

The report, and the note § 7 posts, name issues with the prefix the **Tracker** setting gives.

One shape, every time, so a verdict reads the same on any story. Details first and the ask last, because the user reads the chat from the bottom. In this sample the project's prefix is `SHOP-`, its axes are `priority` and `type`, and its board has a `Status`:

```md
## [SHOP-184](…/issues/184) **"billing/invoices: retire the PDF export"**

Filed 2026-06-02 by jdoe · open · Backlog · `priority:p2` `type:refactor`
Blocked by — · Blocks SHOP-190 · PRs —

**Asks:** Shop Owners lose the legacy PDF export, and the invoice page's print view is the only printable invoice.

### Premise — viable
- Still true: `src/billing/export.ts:88` serves the legacy export today.
- Not overtaken: SHOP-172 (closed) removed the export *button*, not the endpoint. No merged PR touches it.
- Consistent: ADR 0009 names the print view as the invoice's one printable form.

### Decisions
| Decision | Grade | Note |
| --- | --- | --- |
| Drop the stored PDFs in the same PR | thin | No reason given. Recommend a later stage of this story: removing live data lands after the code that stops reading it has deployed. |
| A journey test covers the print view | held | Prior art named. |
| What a Shop Owner with a bookmarked export link sees after the change | missing | No numbered story covers it. |

### Labels
| Axis | Now | Proposed | Why |
| --- | --- | --- | --- |
| `priority` | `p2` | `p1` | SHOP-190 is `p1` and blocked on this. |
| process | — | `ready-for-agent` | Once both answers are in the body, it passes the bar. |
| `Status` | Backlog | Ready | Follows the process label. |

### Verdict — Settle
Close ruled out: the premise holds. Needs info and Split ruled out: nothing only the reporter knows, one goal. Grill ruled out: the two decisions stand alone.

1. **The bookmarked export link** — what does a Shop Owner who follows one see after the change?
   ➡️ A redirect to that invoice's print view: ADR 0009 makes it the one printable form, and the bookmark still lands somewhere useful.
2. **The stored PDFs** — are they deleted in this PR?
   ➡️ No, in a later stage of this story: removing live data lands after the code that stops reading it has deployed.

### Your turn
1. Answer the two questions — I ask them one at a time, next — and I write the answers into the body, set the labels and status above, and post this note.
2. Say **later** and I post this note with the questions, and add the discovery label until they are answered.
```

A run that stops before § 5 — no tracker, an issue it cannot read — keeps the header with what it could read, says under `### Verdict — none` where it stopped and why, and ends with **Your turn**.

Under a **Ready** verdict — or a **Settle** that leaves the story ready — **Your turn** also offers to queue it, where `/up-deliver`'s **Ready signal** is set to a board column or a label: *"Say **queue** and I move it to `Queued` so `/up-deliver` picks it up."* Without that setting, or with it at **None**, offer nothing.

Sections earn their size from the story. A `Premise — viable` line with three citations is a complete section, and an empty `Decisions` table under a `Ready` verdict says the body has nothing left to grade.

Done when the user can act on the report without opening the issue.

## 7. Apply, on the user's word

Nothing above wrote. When the user takes the verdict:

- **Labels and board status in one pass**, where the project keeps a board whose status follows the labels — per `/up`'s [`BOARD.md`](../up/BOARD.md). Set separately, the two drift.
- **Settle** on a discovery body sends the answers to [`/up-to-story`](../up-to-story/SKILL.md), which rewrites it as a story. On a story, it edits the body: each recommendation lands in `## Implementation Decisions` or `## Testing Decisions` as a decision with its reason, and a surface the stories missed becomes a numbered story. The body is working material until the work is on the default branch ([`STORIES.md`](../up-to-story/STORIES.md) `## Frozen once live`); an open story whose work is already live is a **Close**, never an edit.
- **Settle** left unanswered — the user said **later** — posts the note with the questions, and adds the discovery label.
- **Grill**, on the user's word, continues in this window — [`/up-grill`](../up-grill/SKILL.md) on the seed decisions, then [`/up-to-story`](../up-to-story/SKILL.md) rewrites the body from the same context, per [`/up` § 4](../up/SKILL.md#4-walk-it).
- **Close** carries the reason and the issue or PR that made it moot.
- **Needs info** posts the question to the reporter as the comment, and adds the info label.
- **Split** publishes the set through [`SPLITTING.md`](../up-to-story/SPLITTING.md), once the user approved it, then triages each new story.
- **Ready** changes the labels and nothing else.
- **A title change** § 4 proposed: on GitHub, `gh issue edit <n> --title`.
- **Queue**, only on the user's explicit yes to that offer: set the **Ready signal** — move the card to its column per `/up`'s [`BOARD.md`](../up/BOARD.md), or add its label. Their yes is them queuing it; never queue on a bare **apply**.
- **The triage note goes on the issue as a comment** — the verdict, the premise findings and the label delta — so the next agent reading the comments finds the judgement where the story lives.

On GitHub, `gh issue edit <n> --add-label … --remove-label …`, `gh issue comment` and `gh issue close --comment`. On another tracker, the way the **Tracker** setting describes.

Done when the issue carries the labels, status, body and comment the verdict named, and the report says which.

## Guardrails

- **Triage reads.** Every write to the issue waits for § 7 and the user's word. A verdict is a recommendation; the labels are theirs. A missing setting is the one earlier write: it is written when the user answers it.
- **Every row cites.** A premise finding names a path, an issue or an ADR. A label change names the neighbour or the rule that moved it. A grade with no note is an opinion.
- **Ready is a real verdict.** A story with nothing left to decide gets a ready label, not a manufactured question. A grilling nobody needed costs the user an hour.
- **Facts are yours, decisions are the user's.** A thin decision gets a recommendation beside it and stays open until they close it.
- **Depth follows stakes.** A low-priority copy tweak earns a two-minute premise check; a story on a critical path earns every step in full. Say which you did.

## Settings

This skill reads three settings, all defined in `/up` `## Settings` together with the steps that find them. Triage ends in a change to the issue, so it asks for the two it writes with when they are missing:

- **Tracker** at § 1, with its issue prefix.
- **Labels** at § 4.
- **Scopes** at § 4, read when set: without it, the title check is skipped.

It also reads `/up-deliver`'s **Ready signal** at § 6 when it is set, to offer queuing a ready story, and never asks for it.
