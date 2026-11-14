---
name: up-grill
description: Grills the user on a plan, decision or idea in rounds of questions until nothing is left assumed, writing each term and decision it settles into the glossary or an ADR. Use when the user asks to be grilled or to have an idea stress-tested, when decisions turn on each other so no list of questions can be written up front, or to pin down a domain term or record an ADR.
metadata:
  pack: epicparty/skills
  version: 0.1.0
---

# Grill

<!-- upstream: mattpocock/skills skills/productivity/grilling/SKILL.md -->

Interview the user **relentlessly** until you reach a shared understanding. Map the work as a **design tree**: every decision branches into the decisions that hang off it.

The decisions are the user's. Finding the facts is yours.

## 1. Gather the facts first

Read what already holds the work: the `/up-explore` brief, the issue and its comments, the triage note's seed questions — whichever this session has. Read the project's glossary and the ADRs in the area, where `/up`'s [`DECISIONS.md`](../up/DECISIONS.md) says they live.

Without a brief, on code you have not read this session, run [`/up-explore`](../up-explore/SKILL.md) first: it also searches the tracker for an issue that already holds the work.

A question the code, an ADR or a shipped story already answers is a fact, not a decision: settle it yourself and cite where. A fact no tool here can reach — the state of production data, what a person knows — goes to the user as a fact question, marked as one.

Done when every decision on the tree is either answered by a cited fact or waiting on the user.

## 2. Ask in rounds

The **frontier** is every decision whose prerequisites are settled — the questions you can ask _now_ without guessing at answers you have not heard. Ask the whole frontier in one round, numbered, each with your recommended answer, then wait.

```
❓ **Q1** - **<question title>**: <the question, with the context and the choices it needs>

➡️ <your recommended answer>

---

❓ **Q2** - **<question title>**: <…>

➡️ <your recommended answer>
```

Word each question so "yes" accepts your recommendation. A fact question carries **(fact)** after its title, and its recommendation is your best guess at the fact. An ADR offer is a question in the next round. A bare **yes** to a round accepts every recommendation in it; any other answer names the questions it changes.

Each round reshapes the tree: settled decisions push the frontier outward and unblock what depended on them. A question that depends on another question still open in this round belongs to a later round.

When a frontier question needs a fact from the environment, dispatch a subagent with a fresh context to find it rather than asking the user — or find it yourself where subagents are unavailable. Do not block on it: only the questions downstream of that fact wait, and the rest of the frontier goes out now.

Done when the frontier is empty — every branch of the tree visited, nothing silently assumed — and the user confirms you have reached a shared understanding: list the decisions in a few lines and ask whether they capture it. Start no work on it — no story, no code — before that; the glossary and ADR writes of § 3 happen during the rounds.

## 3. Hold the language, in every round

<!-- upstream: mattpocock/skills skills/engineering/domain-modeling/SKILL.md -->

The words settled in a grilling outlive it. Keep them sharp while you ask:

- **Challenge against the glossary.** A term the user uses differently from the glossary gets named at once: "Your glossary defines *cancellation* as X, but you seem to mean Y — which is it?"
- **Sharpen fuzzy words.** A vague or overloaded term gets a precise canonical one proposed: "You say *account* — the Customer or the User? Those are different things."
- **Invent scenarios.** Stress-test the relationships between concepts with concrete edge cases that force the boundaries into the open.
- **Check the code.** When the user states how something works, check whether the code agrees, and surface a contradiction: "Your code cancels whole Orders, but you said partial cancellation is possible — which is right?"

Write as you go, never batched: a resolved term goes into the glossary at once, and a decision that meets the three-part test in [`DECISIONS.md`](../up/DECISIONS.md#writing-an-adr) is offered as an ADR. Most decisions belong in the story instead, and `DECISIONS.md` says which home is which.

A request only to pin a term or record a decision is this step alone: settle it with the user, write it, and report where it went.

Done when every term the session settled is in the glossary and every ADR the user accepted is written.

## 4. Hand on

Report the decisions reached, in the order they were settled, with the glossary and ADR changes beside them. Then run the next skill in this same window, unless the user stops you — the decisions are freshest here:

- **No issue yet** — [`/up-to-story`](../up-to-story/SKILL.md) writes the story from this conversation.
- **An issue that needed grilling** — `/up-to-story` rewrites its body with the answers, per `/up-triage` § 7.

A grilling that ends with decisions still open says which, and who owes the answer.
