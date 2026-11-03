# The design system

The design system is two files, both meant to be committed:

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
- `design-system.json`, next to the designs: what the format has no place for. That is colours
  by palette and the semantic ones with what each is for, how each text style is built from the
  tokens, fonts, shadows, border widths, elevation levels (a surface, its shadow and its
  z-index), breakpoints and container widths, motion, the icon set and themes. It also keeps
  what Sync last agreed on with Figma, `DESIGN.md`, the code and `design.tokens.json`. A
  component's description and category are in its own file (`components/`), and the example a
  new instance starts with is the catalogue's.

**A token's value lives in the design system** ([ADR 0028](../adr/0028-the-design-holds-the-values.md)):
`design-system.json` holds every value in every theme, and `design.tokens.json` beside it says
the same in the [Design Tokens format](https://www.designtokens.org/tr/2025.10/) for Style
Dictionary, Tokens Studio and Figma's variables. When one of those tools changes
`design.tokens.json`, the editor does not write over it: Sync offers what it changed (**Take
design.tokens.json's changes into the design system**), then writes the file again. **Design system**,
on the rail, lists the **Foundations** it has tokens for (Color, Typography, Spacing, Radius,
Elevation, Motion, Breakpoints) and the **Guidelines**, `DESIGN.md`'s sections, with a search over
the tokens, and opens each as boards: every palette as its ramp, 50 to 950, the light and the dark
theme side by side, with the usual pairs of foreground and background and their contrast; the
type scale and the text styles; the other tokens as specimens, the easings animated. Click a token
and the inspector edits its value in each theme, its description and its group, says where it is
used and deletes it; a palette offers **Generate ramp from…** one colour, and a text style its
font, size, weight, leading and tracking. Each change is one undo step, and the canvas draws it
as you type, over your stylesheet's value. The code follows when you export it from Sync (**Bring
the code up to the design**, or `/sync code` for an agent to settle it with you), which writes
your stylesheet in the theme block the token is declared in. Turn on **Write token changes to the
code at once** there to have every edit reach the stylesheet as it is made.

`DESIGN.md`'s front matter mirrors those values in the default theme; its body says how dark mode
differs. When the design system changes a value, the front matter follows. When someone changes a
value in `DESIGN.md`, by hand, from Stitch or in a pull, it waits in Sync, matched and compared
with the design system's as a Figma file's tokens are, until you take it in. A guideline's board
shows its section as a document, edited in the inspector beside it and drawn as you type; what
the linter says is listed under the guidelines.

## Sync

**Sync** (the panel's ⟳ button, its empty state, or `/sync` in a chat) reads what the
repository has and lays out the steps for its case. The Design system button on the left rail
has a dot while something is waiting.

| You have | Sync does |
|---|---|
| nothing yet | starts an application (Vite, React, Tailwind v4, a component for each system component), then defines its design system |
| a Figma file, no application | starts an application with Figma's tokens as its theme, then turns the frames into pages |
| an application, no design system | reads what the code uses, has an agent define the design system, and offers to map and migrate the code onto it |
| a Figma file and an application | matches Figma's tokens to your code's and takes their values first, then the same steps, then the frames |
| a design system | moves `DESIGN.md` to the repository root, or writes a first one; takes what someone changed in `DESIGN.md` or another tool in `design.tokens.json` into the design system; exports what the code is missing and takes in what the code changed alone; lists what drifted (tokens the code has that the design system does not describe, and the other way round) and the `DESIGN.md` sections left to write, for `/sync describe`; compares a newer Figma import |

Settings that point nowhere (no stylesheet) come first in every case: **Detect and apply** proposes where they are and
applies them once you have seen it.

**Figma's tokens are matched first**, to the design system's (to your code's while there is
none), because a Figma file's names
(`Collection 1/Brand/600`) and palette are rarely what the frontend wants. Each variable and
style is one of your tokens, a new token under a name you choose, or left out of the code;
nothing that is not matched is written. Rules match what is certain (the same name, or the one
token with the same value, the semantic colour over its palette entry); **Match with an agent**
(`/sync figma`) has an agent match the rest, asking you where the meaning is yours to say; and
**Review the matches** lists every one to change. The matches are kept with the last sync, so a
newer import of the file goes through them.

Matched tokens are compared with the design system's, one by one and theme by theme: a colour
however it is written (`#3b82f6`, `rgb(…)`, `oklch(…)`), a length in px or rem. Each is also
compared with what the last sync agreed on, which is kept in `design-system.json`:

| Since the last sync | What happens |
|---|---|
| Figma changed it, or it is matched to a token the design system does not have yet | the design system takes Figma's value, in the unit it already uses |
| the design system changed it | it is kept; Figma is behind |
| both changed it, or there was no earlier sync and they differ | you pick, one by one or **All from Figma** / **All from the design system** |

`/init` is still there as the quick way to have an agent describe a theme that is already the
design system.

## Setting one up step by step

When the code has no design system, Sync takes it through five steps, in order; each one stops
for you before the next.

| Step | What happens |
|---|---|
| Inventory | The code is read for the colours, spacing, type sizes and weights, radii, shadows and z-index layers it uses, and the plain `<button>`s and `<input>`s where your library has a component. Each value is the design system's, one of Tailwind's own, or written out (`bg-[#3b82f6]`, `p-[13px]`, an inline style), with how often and where |
| Define | An agent writes the design system. It **adopts** the theme there is, as `/init` does, or **proposes** one from what the code uses: a palette and its semantic colours, a spacing base, a type scale, the radii and shadows, put to you on question cards and then written into the stylesheet's `@theme`. The inventory recommends one of the two; you choose |
| Map | The code is read again against the design system, and each value off it is given what it becomes: a token (`color-primary`, `spacing-3`), the library's component for a plain element, or kept as it is. Rules settle the exact matches; an agent the rest, asking you where the meaning is yours. You can change any of it in the panel |
| Migrate | The code is brought onto the design system a directory at a time. The rules rewrite what is mechanical, classes (`hover:bg-[#3b82f6]/50` → `hover:bg-primary/50`), inline styles and stylesheet declarations; the agent does the rest, a colour in a constant, a `<button>` to `Button`, then runs your type check and linter. Each batch can be reverted on its own |
| Verify | The code is read once more: how many uses are still off the system, against how many there were when the mapping was made, and how many of those are kept on purpose |

A step an agent does runs in a thread of its own, opened with `/design-system <step>` in its
composer and marked with the step it runs. **Stop** ends the agent's turn and keeps what it
did; **Resume** picks it up again. **Redo** puts back every file the step and the later ones
changed, as it was when the step started, after showing you the list, and takes the later steps
back to the start; files you changed yourself in between are left alone. Each step is kept as a
snapshot of the files your `.gitignore` keeps, in the tool's own snapshot store in the state
directory, and so is each batch of Migrate: no git is needed, and your index, branch and stash are
never touched. Where the setup is lives in the state
directory, not in the repository ([ADR 0023](../adr/0023-design-system-setup.md)).

## Design skills

Before it designs, every agent is also told how to design well, whatever the product: hierarchy,
layout, spacing, typography, colour, elevation, borders and radius, iconography, motion,
content, states, how to compose with components, and accessibility. These
skills ship with the tool and come before `DESIGN.md`, which wins where they disagree: a rule
that holds for this product alone belongs in its Do's and Don'ts. **Settings**
lists them, with a switch to turn any off (saved in `ultrapaint.config.json` as `skills.disabled`),
and whether a design thread is told them whole (the default) or by their titles and summaries,
each read whole before the work it is about (`skills.briefing: "summaries"`, about 30,000
characters fewer): an agent with the editor's tools reads a skill as the MCP resource
`skill://ultrapaint/<name>`, one without them a project's file by its path, and is told whole
the skills no file holds (a built-in, or a file that extends one).

A project takes a skill over with a markdown file in `skills/` inside the designs directory:

- a file with a built-in's name (`skills/spacing.md`) replaces it;
- the same file opening with the front matter `extends: true` is told after the built-in instead;
- a file with any other name is a skill of its own.

**Replace…** and **Extend…** in Settings start that file for you, as one undo step. The file's
first heading is its title and the paragraph after it the summary Settings show.

**Design system**'s boards show them: swatches per theme, type specimens in your own fonts,
spacing, radius, shadows, elevation, border widths, layout and motion tokens. The **Library**
lists the components, or shows them as a grid of thumbnails drawn with the example props.
