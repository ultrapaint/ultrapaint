---
name: up-explore
description: Maps what a piece of work involves before anything is decided — provenance, seams, prior art, open questions. Use at the start of unfamiliar work.
metadata:
  pack: epicparty/skills
  version: 0.1.0
---

# Explore

The first move on a piece of work. Explore ends in a **brief**: what already exists, where the change lands, and what nobody has decided yet.

It answers questions. The decisions stay with the user, and the code stays untouched — a brief is what [`/up`](../up/SKILL.md) reads to choose a route, and what any question put to the user is built on.

## 1. Restate the request

One or two sentences, in the project's own words — the domain terms from its glossary, where it keeps one — `/up`'s [`DECISIONS.md`](../up/DECISIONS.md) says where.

A request you cannot restate is a request you have not understood, and every step below would explore the wrong thing.

Done when the restatement uses the domain's vocabulary and the user would recognise their own ask in it.

## 2. Find the provenance

Only when the user named no issue. Search the tracker for one that already describes this work, with the request's own nouns. The tracker is the **Tracker** setting when the settings home has one — read it, never ask for it — or GitHub when `gh repo view` finds the repo: `gh issue list --search "<keywords>" --state all`, then `gh issue view <n> --comments` on a hit. With neither, say no tracker was searched. A hit describing the same work is the provenance; an adjacent one is context, never provenance.

A hit is worth more than anything the codebase will tell you: it carries decisions already made, and its comments carry the ones that never reached the body. A closed hit is worth as much — the work may already be done.

Done when you have the issue, or have searched and found none, or have said no tracker was searched.

## 3. Locate the work

Name where the change lands, concretely:

- **The scope** — from the **Scopes** setting, when the settings home has one; read it, never ask for it. A scope that is not in the vocabulary means the work is scoped wrong, or the vocabulary needs a finding raised against it. With no setting, skip this line.
- **Packages and apps** touched, and the **nearest `AGENTS.md` or `CLAUDE.md`** to each.
- **The standards that govern it** — the documents and skills those agent files route the touched paths to, rather than a guess at which files apply.
- **The validation command** the work will have to pass, as the agent files name it — or, without agent files, the `package.json` scripts.

Done when every path the work will touch has its scope, its nearest agent file, and its routed standards named.

## 4. Read the prior art

Find the code that already does the nearest thing to this, and read it. Then name:

- **The seams** the change can be tested at, existing ones first. The fewest seams is the best number, and the highest seam is the best one. A new seam is a decision, so it goes on the unsettled list rather than into the brief as a fact.
- **The pattern to match** — the neighbouring implementation this work should look like, named by path.
- **The tests that cover the area today**, and at which level — named by the tool that runs them.

Reading three neighbours is cheaper than inventing one pattern, and this is the step that stops the work from arriving as a stranger in its own codebase.

Done when you can point at the file this work should resemble, and at the tests it will sit beside.

## 5. List what is unsettled

The decisions this work turns on that nobody has made. Each one gets a sentence and, where you have one, a recommendation with its reason.

Separate them from the facts. A fact you found in the codebase is yours to report; an unsettled question is the user's to answer, and presenting a guess as a finding is how the wrong feature gets built confidently.

Done when every question the exploration raised is on the list, and nothing on the list is something you could have looked up.

## 6. Report the brief

Short and scannable:

- The restated request, and the issue it came from or that it has none
- Where it lands — product, area, packages, standards
- The seam, the prior art, the test level
- **What is unsettled** — the list, as questions to the user
- **The route you would take**, per `/up`'s table, and the property of the request that chose it — left out when another skill ran this one and the route is already set

Done when the user can answer the unsettled list without opening a file.

## Guardrails

- **Explore reads.** Edits, commits and issues are the later stages' work; this one leaves the tree exactly as it found it.
- **Depth follows stakes.** A one-line copy change earns a two-minute look. A change across a critical path earns every step above in full. Say which you did.
- **An empty unsettled list is a real result.** Some work genuinely has nothing left to decide, and saying so is what sends `/up` straight to `/up-to-story`. Manufacturing a question to look thorough costs the user an answer they did not need to give.
