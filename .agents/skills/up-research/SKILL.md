---
name: up-research
description: Investigates a question against primary sources and reports the findings, publishing a large one where the project keeps its research. Use when a question needs facts from outside this repo, or the user asks for a topic researched. A failure in this code goes to /up-diagnose instead.
metadata:
  pack: epicparty/skills
  version: 0.1.0
---

# Research

A question about facts outside this repo — a platform's behaviour, a library's contract, a spec. Research ends in **findings the user can decide from**, and in a **published note** when the findings are worth going back to.

The decision belongs on the issue or in the ADR. The evidence belongs in the note, at the project's **Destination** setting. A note is evidence and never a rule: an agent that finds research beside the standards follows the evidence instead of the decision, so a note that lands in the repo says so on its first line.

## 1. Investigate

Spin up a **background agent** so you keep working while it reads. Its brief: primary sources first — official docs, source code, specs, first-party help centres — and a secondary source only where no primary exists, labelled as such. Every claim carries its source. A page that blocks fetching is cited from its search snippet and marked `(snippet)`; a claim with no source at all is marked `(unverified)`.

Done when every claim in the findings has a source or a mark.

## 2. Report

The reply is the findings' default home, sized to the question: an answer with its sources, or a comparison table with a synthesis. Lead with what the user asked, then what it means for the decision in hand.

Done when the user can decide from the reply alone.

## 3. Decide the home

A research earns a published note when both hold:

- **It is big.** A comparison across many sources, or more than a reply carries without burying the answer.
- **Something will cite it.** A story, an ADR or a PR will point back at it, or the user says they want to go back to it.

Both hold: publish (§ 4). Only the first holds: ask the user whether to keep it. Neither: the reply was the whole deliverable, and the agent's working notes are discarded with it.

Done when the home is named: the reply, or a published note.

## 4. Publish

Read the **Destination** setting now, per [Settings](#settings). This is the one step that needs it, so a research that ended in the reply never asks.

Every destination takes the same note:

- **Title**: `Research: <the question>`.
- **Body**: the date, the question, the method and its limits, the findings with inline `[n]` citations, the synthesis, and the `Sources` list. The whole note, so it stands without the chat.

Then publish it the way the setting says.

**GitHub Discussion** — one Discussion in the setting's category, resolved by name, never by id:

```sh
publish_research() { # publish_research <category> <title> <body-file>
  # Braced on purpose: the harness substitutes skill arguments into a bare $N.
  local category="${1}" title="${2}" body_file="${3}"
  local owner name repo_id category_id
  read -r owner name < <(gh repo view --json owner,name --jq '"\(.owner.login) \(.name)"')
  read -r repo_id category_id < <(gh api graphql -f query='
    query($o:String!,$r:String!){ repository(owner:$o,name:$r){ id
      discussionCategories(first:20){ nodes{ id name } } } }' \
    -f o="$owner" -f r="$name" \
    --jq ".data.repository | \"\(.id) \(.discussionCategories.nodes[] | select(.name==\"$category\") | .id)\"")
  [[ -z "$category_id" ]] && { echo "no $category category: a maintainer creates it under Settings → Discussions" >&2; return 1; }
  gh api graphql -f query='
    mutation($r:ID!,$c:ID!,$t:String!,$b:String!){
      createDiscussion(input:{repositoryId:$r,categoryId:$c,title:$t,body:$b}){ discussion{ url } } }' \
    -f r="$repo_id" -f c="$category_id" -f t="$title" -f b="$(cat "$body_file")" \
    --jq '.data.createDiscussion.discussion.url'
}
```

A missing category stops the publish: say so, because only a human can create one.

**A file in this repo** — `<directory>/<YYYY-MM-DD>-<slug>.md`, its first line `> Research evidence, not a rule. The decision lives in the issue or ADR that cites this note.` Write it to the working tree and name the path; it is committed when the user asks, or with the work that cites it.

**Somewhere else** — follow the setting's instructions as written. A tool they name that this session cannot reach stops the publish: say which one.

Done when the reply carries the note's URL or path.

## 5. Cite

Whatever the research fed — the story, the ADR, the PR body — links the note and states the conclusion in one line beside the link. A reader of the issue learns what was decided without opening the note, and opens it only to see why.

Done when the citing document names the decision and the link.

## Settings

This skill reads one **setting**, **Destination**, at § 4. Each `###` heading below is one setting: its topic, its question, and its options. `/up-setup` reads the same headings to ask every setting up front.

1. **The settings home.** The `## Agent skills` block of the root `AGENTS.md` — or `CLAUDE.md`, whichever the project has — names where `up-*` settings live and in what form. With neither file present, first ask which to create, recommending `AGENTS.md`, which most agents read. With no such line, ask the user where to keep them, the default first:
   - **`docs/agents/<topic>.md`** (default) — one Markdown file per topic, one `##` heading per setting, named as the setting. Other headings in the file are the project's own notes.
   - **One file** — at a path the user names.
   - **Another form** — as the user describes it.

   Write their answer as one line in that block, creating the block when it is missing — for the default, `` `up-*` settings: `docs/agents/<topic>.md`, one heading per setting. ``
2. **The setting.** Read it at the settings home. Present: use it, and ask nothing.
3. **Missing.** Ask its question below, recommended answer first, with the follow-up its option needs. Write the answer at the settings home, tell the user where it went and that they can edit it there or through `/up-setup`, then continue.

### Destination

Topic `research`. Question: *Where should research worth keeping be published?*

| Option | Follow-up | Recommend when |
| --- | --- | --- |
| **GitHub Discussion** | The category name, default `Research` | The repo has Discussions on (`gh repo view --json hasDiscussionsEnabled`) |
| **A file in this repo** | The directory, default `docs/research/` | Discussions are off |
| **Somewhere else** | The instructions, in the user's words: the tool, the place, the format | — |
| **Nowhere** | — | — |

**Nowhere** makes the reply every research's home: § 3 then names the reply and § 4 never runs.

## Guardrails

- **Findings are facts, decisions are the user's.** Report what the sources say and what it implies for the choice in hand; put the choice to the user.
- **One note per question.** A follow-up on the same question extends that note — a comment on the Discussion, a dated section in the file — rather than starting a second one.
- **A note is evidence, never a rule.** Nothing in `AGENTS.md`, a standard or a skill points at one as the thing to follow; they point at the ADR or the story that decided. A note directory stays out of every standards route.
