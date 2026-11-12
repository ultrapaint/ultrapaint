# ADR 0087: The designs' history is Ultrapaint's own, and git stands apart

Status: accepted, 2026-11-12. Replaces 0008 (agent turns' checkpoints) and the named snapshots
of 0019; amends 0031 (writing to git is a setting) and 0076 (the Changes panel's lists).

## Context

The Changes panel listed three things of equal weight: git's changed files (only when there
were some), the named snapshots, and the agent turns' checkpoints. Whether git was written to
was a setting the panel did not show ("Write to git", off by default). A checkpoint was the
designs before a turn, the last 30 kept, named by a cut prompt ("Try again", "/init") with no
agent or chat; a snapshot was a point the person named, kept until deleted. The person's own
edits between turns were in no history: the next turn's checkpoint folded them into "before the
turn", and with no turn after them they were nowhere.

The person, asked over five decks (`changes-panel-nov12` to `-nov12e`), settled it, after a
study of seventeen tools (Figma, Google Docs, Penpot, Notion, Framer, Sketch, Webflow, Miro,
Canva; Lovable, v0, Bolt, Replit, Cursor, Claude Code, Windsurf, Copilot). Every one keeps two
tiers, automatic points pruned or folded and named ones kept; most AI tools do not track the
person's own edits, and users complain of exactly that; the hosted ones restore without deleting
anything; none of the design tools ties its history to git, and those that commit for the
person fill its log.

## Decision

**Three things, each in its own place.** The files (the pages, `DESIGN.md`) are in the
project's folder and saved as anyone edits. The **history** is Ultrapaint's record of how they
changed, in its own snapshot store, for every project, git or not. **Git** is there only when
the folder is a repository: what changed since the last commit, and a commit the person makes.

**The history is a list of points** (`History`, the store's `history` namespace), each the
designs right after something happened, newest first:

- **The person's edits** (the journal's writes for the editor): closed into a point two minutes
  after the last edit, ten minutes after the first while they go on (as Notion), and always
  before anything else writes (an agent's turn, a change from outside, a restore, a version).
  Never folded into an agent's turn.
- **An agent's turn**, from its prompt to its end: its prompt, the agent and its model, its
  thread. What changes meanwhile is the turn's. A turn that changed nothing makes no point.
- **Files changed from outside** (a pull, a checkout, a text editor, what the watcher sees with
  no writer known), once they settle for a second, and the files as found when the project
  opens: a muted row with nothing to do on it, the person's edits before it kept apart.
- **A restore**: the edits not in a point yet closed first (a stash), the designs put back as
  the point kept them in one undo step, and a point that says so. Nothing is deleted.

Each point keeps every design file but the comments, and lists the files and canvases it changed
from the one before. **A version is a point the person named**; naming one never copies it.
**Nothing is ever let go of**, and there is no setting for it. The named snapshots and the
checkpoints kept before are brought in once as points ("imported").

**The Changes panel** is the history, and, only in a repository, a second tab by the branch
with how many design files git sees changed. History: **Now** (the edits not in a point yet,
"2 edits since 1:32 PM") with **Save version**, then the points by day. A turn reads as what was
asked, under it the agent's mark, greyed, its model, the canvases ("Redesign +1") and the time;
the person's points one after another fold into one row. **A point clicked opens a preview**
beside the panel: each page it changed before and after, drawn by the canvas's own renderer, and
**Restore**, which takes the designs to that point and says in its toast what was kept first,
with Undo. Its menu: Restore, Open on canvas, Open the chat, Save as version… or Rename… and
Remove from versions.

**Git stands apart and is written only by the person's Commit.** The "Write to git" setting
goes, and with it `git.init`. The **Git** tab (named so, with how many design files changed)
lists what git sees, each named as the editor names it (a page by its name and canvas, a canvas,
a component, the design system's file), its lines added and removed as git counts them (`+12`
in the success colour, `−3` in the destructive one), a tick on each: Ultrapaint's ticked unless
the person unticks them, the others folded and unticked (ADR 0076). The **commit card** sits at
the panel's foot whatever the list holds: "Message" and the branch it commits to, a message box
that grows, and a full-width **Commit 3 changes**; git's words go under the box when it refuses.
With nothing changed the tab says so and names the last commit. Pressing Commit is the approval.
Saving a version never commits, and nothing commits on its own. Without a repository nothing of
git is shown. `ultrapaint new --git` still makes a repository with a first commit, asked for.

## Consequences

- The person's edits, an agent's turn and a pull are told apart, and going back to any of them
  is one undo step that leaves every later point in the list.
- The store grows with every point; a file unchanged from one point to the next is kept once.
  If space ever matters, a setting comes then.
- Two agents' turns at once are one stretch: the first to end makes the point of both.
- The person's edits made while an agent works are the turn's; an agent outside the editor that
  writes through the editor's requests (ADR 0083) is taken for the person.
- A point's diff as text is gone from the panel; a file's git diff stays in the git tab.
- The preview draws a page with the design system of now, not of the point.
