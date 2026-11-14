# Issue tracker: GitHub

Settings for the `up-*` skills that read or write an issue. The `## Settings` section of `/up`
([`.agents/skills/up/SKILL.md`](../../.agents/skills/up/SKILL.md)) defines each one.

Issues live in GitHub Issues on `ultrapaint/ultrapaint`, and every operation runs through the
`gh` CLI, which infers the repository from `git remote -v`. Anything worth doing is an issue:
there is no second backlog.

## Issues are user stories

What goes inside an issue is [`STORIES.md`](../../.agents/skills/up-to-story/STORIES.md). Read
it before writing or editing one. An issue is **frozen once the work delivering it lands on
`main`**: a later change of scope or logic becomes a new issue, never an edit.

Ultrapaint adds, and wins where the two differ:

- **Titles** are `<scope>: description`, the scope from [`naming.md`](./naming.md). The issue
  carries no commit type: its `type:*` label does.
- **Labels:** one `area:*`, one `priority:*` and one `type:*` (`## Labels`). The Ready bar's
  "every label axis is set" means all three, with `needs-triage` gone. A refinement takes
  `type:improvement` when it moves the behaviour further, and `type:bug` when what shipped does
  not match its story.
- **Roles** in the story sentence are the person's role, named as [`GLOSSARY.md`](../../GLOSSARY.md)
  names things: `As a designer`, `As a developer` (designing an app in their own repository),
  `As an agent` (an outside agent working through Ultrapaint's MCP tools, ADR 0083). An enabler
  story is `As a maintainer`. Never `As a user`.
- **Testing Decisions** name one of the levels in [`testing.md`](./testing.md).
- **Decisions:** a story that settles a behaviour names the ADR it follows, or says a new ADR is
  part of the work (`docs/adr/`, indexed in `docs/adr/README.md`).
- **The design skill:** a correction of a design made with `skills/ultrapaint/` is a gap in
  `evals/gaps/`, not a story (root `AGENTS.md`).

## Tracker

GitHub Issues, with the issue prefix `UP-`, and the **Ultrapaint Board** (see `## Project board`).

**Referring to an issue.** Write **`UP-42` for an issue** and **`#42` for a pull request**:
GitHub shares one number space across both. The first mention in a chat reply, a report or a PR
body reads `[UP-42](https://github.com/ultrapaint/ultrapaint/issues/42) **"<title>"**`. In issue
and commit bodies, `UP-42` is plain text. `Closes #42`, `Part of #42` and `Refines #42` keep `#`,
because GitHub acts on them.

| Stage | Board status |
| --- | --- |
| Ideas | `Ideas` |
| Triage | `Triage` |
| Backlog | `Backlog` |
| Ready | `Ready` |
| Queued | `Queued` |
| Building | `Implementing` |
| Review | `Review` |
| Shipping | `Shipping` |
| Done | `Done` |

Automations: `Auto-add to project` (filter `is:issue`), `Item added to project` → `Triage`,
`Pull request linked to issue` → `Review`, `Item closed` → `Done`.

## Labels

Every issue carries one label from each axis.

| Axis | Values | Meaning |
| --- | --- | --- |
| `area:*` | `editor`, `server`, `document`, `desktop`, `cli`, `skill`, `evals`, `repo` | The part of Ultrapaint that owns it: the **Scopes** setting ([`naming.md`](./naming.md)), and the scope of its title. |
| `priority:*` | `p0-urgent`, `p1-high`, `p2-medium`, `p3-low` | `p0` displaces other work. `p1` is built before any `p2`: it hurts people now, or other work waits on it. `p2` is planned and wanted. `p3` has no committed date. An issue with no `priority:*` label carries `needs-triage` instead. |
| `type:*` | `feature`, `bug`, `improvement`, `refactor`, `chore` | The nature of the change. The commit type follows from it, unless the change contradicts the label: then the change decides, and the commit says so. |

The roles: triage `needs-triage`, info `needs-info`, discovery `needs-grilling`, ready for an
agent `ready-for-agent`, ready for a human `ready-for-human`, won't fix `wontfix`, epic `epic`.

| Label | Meaning |
| --- | --- |
| `needs-triage` | Nobody has evaluated it yet. Outranks any `priority:*` already on it. |
| `needs-info` | Waiting on the reporter before it can be judged. |
| `needs-grilling` | A decision is unmade: the discovery shape of `STORIES.md`. |
| `ready-for-agent` | Fully specified: an agent can deliver it with no further conversation. |
| `ready-for-human` | Specified, but a person implements it. |
| `wontfix` | Will not be done. |
| `epic` | An outcome made of several goals, whose `## Stories` checklist becomes the child issues. |

An issue with no role label and all three axes set is in the backlog.

`accessibility` is a tag outside the axes: a barrier affecting people with disabilities, added
beside the three axes where it applies.

### Label colours

Each family has its own band, so a row of labels reads at a glance:

| Family | Band | Values |
| --- | --- | --- |
| `area:*` | Blues, greys and two accents, away from the priority ramp | `editor` `#448AF7` · `server` `#0F6E8C` · `document` `#74C0FC` · `desktop` `#364FC7` · `cli` `#8A9199` · `skill` `#F783AC` · `evals` `#A0785A` · `repo` `#5C6370` |
| `priority:*` | Warm-to-green ramp | `p0-urgent` `#B60205` → `p1-high` `#E8590C` → `p2-medium` `#FFD43B` → `p3-low` `#7FB800` |
| `type:*` | Cool half only | `bug` `#D6246E` · `feature` `#7048E8` · `improvement` `#0CA5A5` · `refactor` `#3E5C76` · `chore` `#B197FC` |
| Roles | Neutral greys | `needs-triage` `#E4E4E4` · `needs-info` `#CFCFCF` · `needs-grilling` `#B5B5B5` · `ready-for-human` `#57606A` · `ready-for-agent` `#24292F` · `wontfix` `#6E7781` · `epic` `#4A2B6E` |

A new label takes a colour from its family's band.

## Project board

The **Ultrapaint Board** ([project 1](https://github.com/orgs/ultrapaint/projects/1)) is a
Projects v2 board owned by the `ultrapaint` organisation and linked to this repository. A
repository cannot own a Projects v2 board, so owned by the organisation and linked is as close as
the API allows. It is the one open board linked to this repository, and the commands find it by
that link, not by its title.

Its automations (`## Tracker`) are set in the board's Workflows, in the web UI: GitHub's API
cannot set them.

The stages, the rules for each and the commands are `/up`'s
[`BOARD.md`](../../.agents/skills/up/BOARD.md). Ultrapaint adds:

- **Only a person moves a card into `Queued`**, or an agent on that person's explicit yes.
- **"Create a story"** means one new issue, through `/up-to-story`. **"Save it as an idea"**
  means a draft item in `Ideas`, never a real issue.
- Pull requests are not on the board: `Auto-add to project` filters on `is:issue`.
