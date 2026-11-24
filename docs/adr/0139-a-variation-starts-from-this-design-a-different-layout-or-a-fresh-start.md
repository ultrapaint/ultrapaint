# ADR 0139: A variation starts from this design, a different layout or a fresh start

Status: accepted, 2026-11-24. Amends 0098 (variations made by an agent), 0095 (the composer's
tray) and 0014 (two of the editor's tools answer by the calling chat). Built by UP-172.

## Context

The person asks an agent for a new design of a screen that already exists, and gets one close to
the current screen. They then have to ask again for a whole new layout. They want the agent to
know what the screen holds, what it is for and who uses it, without copying its look and layout.

Each source of the pull is in what the agent is handed:

- **A variation round** (0098) gives each take a working copy of the page as it is. The task says
  to change the thing "in the copy" with `read_page` and `apply_operations`, to "keep the ids of
  the nodes you keep", and to stay "within the design system". One agent makes every take in
  turn, and only the earlier takes' names tell it to make the next one unlike them.
- **One change** from Ask an agent starts with the whole tree and a screenshot, and edits in place.
- **The design skill** has no redesign step. A screenshot of the screen, read as "a picture to
  remake", falls under the rule "nothing missing, nothing added, the same place".
- **The lab** saw the same pull in the editor's own redesign of 3 Nov (gaps p06 and p12).

Research of 2026-11-24 (`~/Code/ultrapaint-data/research/2026-11-24-fresh-redesign-anchoring.md`):

- An example in view is copied, by designers and by models alike, and an instruction not to copy
  it does not stop that.
- Words anchor less than pictures.
- Several designs made side by side, each given a different direction, beat refining one.
- Planning the directions before generating is the strongest way to make the results differ.
- Tools that do this well set **how far** from the original apart from **what is kept**.

The person chose from a decisions deck (24 Nov), then answered two more questions in the thread.

## Decision

**A round of variations starts from one of three places, its distance:**

- **This design**: as today. Each take is a copy of the thing to change in place.
- **Different**: each take is a copy too, and each must change the layout: how the thing is
  arranged, and what leads it. The content stays.
- **Fresh**: each take starts empty and is drawn from the **content brief** alone. The editor never
  gives the agent the thing's tree or picture (below says how, and the one way the person may).

The distance applies to pages and containers, a component's main tree among them. A take of a
text is already other words, and a take of an image another picture, so theirs is always This
design.

**Every round names its directions first.** Before the first take, the agent writes one direction
per take in its plan, and each take is named after its direction:

- At Different and Fresh, each direction is a different layout model or a different main thing,
  and the brief's line on today's layout is named as what to avoid.
- At This design, each is a different answer to what should vary.

One agent still makes every take, in one chat. A chat per take waits until the lab shows that
takes with planned directions still look alike.

**The content brief** is the thing as words, written by the server from its tree:

- the page it is on, and its URL;
- every text in reading order;
- the images by their asset (`src`) and their alt, so that a take can place the same picture;
- the components it places, with the props that are words;
- where each link goes;
- the states the page has.

It also gives **one line on today's layout**: the top two levels' arrangement and the components
there, given as what to avoid. That line is the only thing a Fresh take is told about the layout.
The brief goes to Different and Fresh rounds. At Fresh, before drawing, the agent writes the
thing's job and its users from the brief, in the chat, and goes on without waiting for an answer.

**A Fresh round keeps its agent from the original:**

- It always runs in a chat that has not seen the original: a new chat, opened in front, from
  either place it is asked (below). A chat that read the page earlier would still hold its tree
  or picture, whatever the tools refuse later.
- The working copy holds the thing's node with its id, type and size, and nothing of what was
  inside it.
- `read_page` and `get_screenshot` refuse the original page to that chat, and say why, for as
  long as the chat lives: the editor never gives a chat opened for a Fresh round the original.
  Try again and Make more therefore stay in it, and a new round there is fresh too.
- What the person attaches to the prompt goes with it as they attached it. A picture of the
  original that they attach is theirs to give, and the only way the round sees it.
- Neighbouring pages stay readable, so actions keep their names and places across screens.
- Each take is checked against the brief: nothing in it lost.

**What a Fresh round keeps of the design system** is the person's choice, its **Keep**:

- **Design system**: the default, as today.
- **Brand only**: the colours, the typeface and the logo stay. Spacing, radius, sizes and density
  are free, and a control may be drawn from parts where the system's component would bring the
  old look back. A take put in use leaves values on the page that are outside the system. The
  checks show them until the system takes them in.
- A third choice, **Nothing**, is left for when a take's look can become the design system.

**Where it is asked:**

- **Ask an agent's popover.** Its tray gains **Start from** (This design, Different, Fresh) next
  to Variations, and **Keep** next to them while Start from is Fresh. Both are remembered in the
  browser, as the count is. Fresh or Different with One change makes a single take and keeps the
  original. Start from is not offered on a text, an image or several things selected. Make
  variations… opens the same popover, so it has Start from too; there is no other place to ask.
- **A design chat's composer.** Its tray (0095) gains Start from beside Skills and Review, and
  Keep while it is Fresh. The composer has no count of its own. The chat's Start from is This
  design in a new chat and stays as set while the chat is open. A chat opened for a Fresh round
  offers Fresh alone, as a copy at This design or Different would show it the original.
  - At This design the prompt is sent as always.
  - At Different or Fresh, each page and container the prompt attaches gets its own round of
    variations, one after another. Each round takes the count last chosen in Ask an agent (three
    the first time), and the prompt's words as what should vary.
  - Different rounds run in this chat, which may have seen the page: a Different take sees it
    anyway. Fresh rounds open in a new chat in front, as Ask an agent's are, and this chat gets
    a line that links to it (the person's answer of 24 Nov, after review).
  - Other attachments go to the rounds as context, to a Fresh round's new chat too (above).
  - With nothing to vary attached, the send button is disabled and says what to attach.
  - Like every prompt site, it is listed in the editor's prompt test (0074).

**The task carries it:**

- The `Variations` task request gains `distance` (`this`, `different`, `fresh`; `this` when absent)
  and `keep` (`system`, `brand`; Fresh only).
- `/variations` reads them as `start=` and `keep=` words after the count, in any order, before
  what should vary: `/variations /orders#c_1 3 start=fresh keep=brand what should vary`. Only a
  word of that form is an option, so what should vary may begin with any word ("different
  colours"). An unknown value (`start=bold`) is refused with the values allowed, and `keep=`
  without `start=fresh` is refused.
- A round keeps both, so that Try again and Make more go on at the same distance.

**The design skill is not changed now.** Gap p17 ("A redesign drawn as the screen it replaces")
holds the evidence. The lab's redesign track compares rounds at each distance on hosts that have
screens, scoring how far the takes are from the original and from each other, and how much of the
brief survives. The skill gains a redesign step only if the track shows that step adds distance
at Different or Fresh beyond the editor's change, without losing content or quality.

## Consequences

- A redesign is a round of variations. There is no new task, no new MCP tool and no new surface:
  the takes are laid out and chosen as 0098 lays them out.
- The tool budget is untouched. The brief is in the task's text, and the refusal is a rule inside
  two tools.
- The agent can still open the page's file from its shell during a Fresh round. That limit is
  accepted: the task forbids it, the round's chat is new, and the tools refuse the original.
- Brand only can leave values on a page that are outside the system. That is the price of
  breaking out of the old look, and the checks name each one.
