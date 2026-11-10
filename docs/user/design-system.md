# The design system

The design system is three files, all meant to be committed:

- `design.tokens.json`, in the designs directory: every token's value in every theme, in the
  [Design Tokens format](https://www.designtokens.org/tr/2025.10/) that Style Dictionary, Tokens
  Studio and Figma's variables read ([ADR 0035](../adr/0035-design-tokens-hold-the-values.md)).
  When another tool changes it, its values are the design's as soon as the file is read again:
  nothing waits for you to take them.
- `design-system.json`, beside it: what the values are not. The tokens' names, groups and
  descriptions, how each text style is built from the tokens, elevation levels, the icon set,
  and what the code, Figma and `DESIGN.md` last agreed on with the design system. A component's
  look, description and category are in its own file (`components/`).
- `DESIGN.md`, at the root of the repository, in the open
  [DESIGN.md format](https://github.com/google-labs-code/design.md) that coding agents and design
  tools read and write ([ADR 0027](../adr/0027-design-md.md)):
  - its front matter holds the tokens (`colors`, `typography`, `rounded`, `spacing`), kept in
    step with the design system, and the `components` whose look you took over, from their files;
  - its body says, in the format's sections, what the product is, which colours mean what,
    which component to use for what, and what to always or never do.

  Every agent is told it, and an agent outside the editor finds it too. The format's own linter
  checks it: broken references, contrast, section order. A `DESIGN.md` in the designs directory
  is still read, and Sync moves it to the root.

**A token's value lives in the design system**
([ADR 0028](../adr/0028-the-design-holds-the-values.md)). A change made in the editor writes both
files in one step you can undo. When `design.tokens.json` does not read, **Foundations** says so
over its list (**Not a valid tokens file.**), with the file to fix and why: until then the values
shown are `design-system.json`'s and the code's. When `design-system.json` does not read, it says
**Not a valid design system.**, lists no foundations, and designs are drawn in Ultrapaint's
default look until you fix it. The editor reads a file again when it is saved.

## Foundations

**Design system**, in the place switch at the top, shows the design system on boards of its own,
on a tinted, dotted canvas so that it is never taken for the pages. **Foundations**, on the rail,
lists the foundations it has tokens for (Colour, Typography, Spacing, Radius, Elevation, Motion,
Breakpoints) and the **Guidelines**, `DESIGN.md`'s sections, with a search over the tokens; what
the linter says is listed under them. Each opens as boards: every palette as its ramp, 50 to 950,
the light and the dark theme side by side, with the usual pairs of foreground and background and
their contrast; the type scale and the text styles; the other tokens as specimens, the easings
animated. On boards other than Colour, the tools' sun and moon pick the theme they are drawn in.

Click a token and the inspector edits its **Value** in each theme, its **Description** and, for a
colour, its **Group**, and says where it is **Used in**; its **…** deletes it. A colour offers
**Generate ramp…**, which makes its palette's shades from one colour, and a text style its font,
size, weight, leading and tracking. Each change is one undo step, and the canvas draws it as you
type, over your stylesheet's value. A guideline's board shows its section as a document, edited in
the inspector beside it and drawn as you type.

The code follows when you export it from Sync (**Bring the code up to the design**, or `/sync
code` for an agent to settle it with you), which writes your stylesheet in the theme block the
token is declared in. Turn on **Write token changes to the code at once** there to have every
edit reach the stylesheet as it is made (`codeTokens: "auto"` in the configuration).

`DESIGN.md`'s front matter mirrors those values in the default theme; its body says how dark mode
differs. When the design system changes a value, the front matter follows. When someone changes a
value in `DESIGN.md`, by hand, from Stitch or in a pull, it waits in Sync, matched and compared
with the design system's as a Figma file's tokens are, until you take it in.

## The default look

A project has no design system until you make one
([ADR 0062](../adr/0062-a-new-person-starts-from-a-prompt-or-a-project.md)). Until then its
designs are drawn in **Ultrapaint’s default look**, which Foundations shows like any design
system, with the ways to make the project's own above it:

- **Make it from the code** opens a chat, **Design system from the code**, in which an agent
  reads your theme and components and writes the design system (`/init`);
- **Other ways** › **Pick a new look…** opens the look page;
- **Other ways** › **Import from Figma…** takes a `.fig` file's tokens ([Figma](figma.md)).

The default look's values cannot be changed on its boards: the inspector says **The default look
is fixed**, with **Make it from the code**.

## Picking a look

The look page shows sample screens on the canvas and, in **Pick a look** beside them, the dials
that make the look: **Start from** (a preset), **Brand colour**, **Greys**, **Corners**,
**Density**, **Surfaces**, **Typeface**, **Icon stroke**, and **Tokens**, the names its colour
tokens take (**Simple**: shadcn's roles, `primary`, `muted-foreground`; **Detailed**: by property
and meaning, `text-subtle`, `border-focus`). The samples follow the dials as you turn them.

**Use this look** writes it as the project's design system. **Or describe it to an agent** takes a
description, a site or pictures and has an agent make the look from them; **Let the agent decide**
leaves it to the agent. Opened from the start screen's **I’ll pick the look**, the page comes
before the first screen, and your prompt is sent once the look is settled.

## Sync

**Sync** (Foundations' ⟳ **Sync with the code**, or `/sync` in a chat) reads what the repository
has and lays out the steps for its case. **Design system** in the place switch, and Foundations on
the rail, have a dot while something is waiting, and Foundations lists it at the top with
**Review**.

| You have | Sync does |
|---|---|
| nothing yet | starts an application (**Start an application…**: Vite, React and Tailwind v4, with a set of components to start from), then defines its design system |
| a Figma file, no application | starts an application with Figma's tokens as its theme, then turns the frames into pages |
| an application, no design system | reads what the code uses, has an agent define the design system, and offers to map and migrate the code onto it |
| a Figma file and an application | matches Figma's tokens to your code's and takes their values first, then the same steps, then the frames |
| a design system | moves `DESIGN.md` to the repository root, or writes a first one; takes what someone changed in `DESIGN.md` into the design system; exports what the code is missing and takes in what the code changed alone; lists what drifted (tokens the code has that the design system does not describe) and the `DESIGN.md` sections left to write, for `/sync describe`; compares a newer Figma import |

Settings that point nowhere (no stylesheet) come first in every case, as **Point Ultrapaint at
your code**: **Detect and apply** proposes where they are and applies them once you have seen it.

**Figma's tokens are matched first**, to the design system's (to your code's while there is
none), because a Figma file's names (`Collection 1/Brand/600`) and palette are rarely what the
frontend wants. Each variable and style is one of your tokens, a new token under a name you
choose, or left out of the code; nothing that is not matched is written. Rules match what is
certain (the same name, or the one token with the same value, the semantic colour over its
palette entry); **Match with an agent** (`/sync figma`) has an agent match the rest, asking you
where the meaning is yours to say; and **Review the matches** lists every one to change. The
matches are kept with the last sync, so a newer import of the file goes through them.

Matched tokens are compared with the design system's, one by one and theme by theme: a colour
however it is written (`#3b82f6`, `rgb(…)`, `oklch(…)`), a length in px or rem. Each is also
compared with what the last sync agreed on, which is kept in `design-system.json`:

| Since the last sync | What happens |
|---|---|
| Figma changed it, or it is matched to a token the design system does not have yet | the design system takes Figma's value, in the unit it already uses |
| the design system changed it | it is kept; Figma is behind |
| both changed it, or there was no earlier sync and they differ | you pick, one by one or **All from Figma** / **All from the design system** |

`/init` (Foundations' wand, **Run /init with an agent**) is still the quick way to have an agent
describe a theme that is already the design system.

## Setting one up step by step

When the code has no design system, Sync takes it through five steps, in order; each one stops
for you before the next.

| Step | What happens |
|---|---|
| Inventory | The code is read for the colours, spacing, type sizes and weights, radii, shadows and z-index layers it uses, and the plain `<button>`s and `<input>`s where your library has a component. Each value is the design system's, one of Tailwind's own, or written out (`bg-[#3b82f6]`, `p-[13px]`, an inline style), with how often and where |
| Define | An agent writes the design system. It **adopts** the theme there is, as `/init` does, or **proposes** one from what the code uses: a palette and its semantic colours, a spacing base, a type scale, the radii and shadows, put to you on question cards and then written into the stylesheet's `@theme`. The inventory recommends one of the two; you choose |
| Map | The code is read again against the design system, and each value off it is given what it becomes: a token (`color-primary`, `spacing-3`), the library's component for a plain element, or kept as it is. Rules settle the exact matches; an agent the rest, asking you where the meaning is yours. You can change any of it in the panel |
| Migrate | The code is brought onto the design system a directory at a time. The rules rewrite what is mechanical, classes (`hover:bg-[#3b82f6]/50` → `hover:bg-primary/50`), inline styles and stylesheet declarations; the agent does the rest, a colour in a constant, a `<button>` to `Button`, then runs your type check and linter. Each batch can be put back on its own (**Revert**) |
| Verify | The code is read once more: how many uses are still off the system, against how many there were when the mapping was made, and how many of those are kept on purpose |

A step an agent does runs in a chat of its own: **Start with an agent** opens it with
`/design-system <step>` in its composer, for you to send, and **Open chat** goes back to it.
**Stop** ends the agent's turn and keeps what it did; **Resume** picks it up again. **Redo** puts
back every file the step and the later ones changed, as it was when the step started, after
showing you the list, and takes the later steps back to the start; files you changed yourself in
between are left alone. Each step is kept as a snapshot of the files your `.gitignore` keeps, in
the tool's own snapshot store in the state directory, and so is each batch of Migrate: no git is
needed, and your index, branch and stash are never touched. Where the setup is lives in the state
directory, not in the repository ([ADR 0023](../adr/0023-design-system-setup.md)).

## Design skills

Before it designs, every agent is also told how to design well, whatever the product: the design
skill, which ships with the tool. Its core holds every rule (hierarchy, restraint, layout,
spacing, type, colour, surfaces, icons, components, states, usability, accessibility, words,
motion) and the steps of a design, and names the reference to read for each kind of screen or
page and for what a rule line cannot hold. It comes before `DESIGN.md`, which wins where they
disagree: a rule that holds for this product alone belongs in its Do's and Don'ts, and what it
chose for its words (how they sound, the one name of each thing, its formats) in its Content
section.

**Settings** › **Agents** › **Design skills** lists the skills, with a switch to turn any off
(saved in `ultrapaint.config.json` as `skills.disabled`; the design skill is `ultrapaint`), and
**Told as**, how a design thread is told them (`skills.briefing`): **Core** (`router`, the
default), the core whole and a reference read when the core sends the agent to it; **Whole**
(`full`), the core and every reference whole; or **Summaries** (`summaries`), each skill by its
title and summary, read whole before the work it is about. An agent with the editor's tools reads
the design skill as MCP resources (`skill://ultrapaint/SKILL.md` and
`skill://ultrapaint/references/…`), one without them from the copy the tool writes in
`~/.cache/ultrapaint/skills/`.

A project adds skills of its own as markdown files in `skills/` inside the designs directory
(`skills/brand.md`): each is told whole after the design skill, and read as
`skill://ultrapaint/<name>` too. The file's first heading is its title and the paragraph after it
the summary Settings shows. The design skill itself is not replaced or extended by a file: what
this product chose goes in `DESIGN.md`.
