/** Built-in skill. The file is the skill: its heading is the title, the paragraph after it the summary. */
export const layout = {
  name: "layout",
  text: `# Layout

A page is a few large regions on a grid, and it holds at every width the product supports.
Decide the regions first, then fill them.

## Regions before components

Build a page from a few regions: a header, a navigation, a main column, maybe a side panel. Lay
them out as rows and columns, then fill them with components.

## A few shared edges

Pick a few alignment edges and put everything on them. Left edges of text line up, labels and
values share a baseline (\`crossAlign: "baseline"\`) and every column starts at the same x. Each
stray edge reads as noise, even when nobody can name it.

## Width has a ceiling

The main column takes a \`maxWidth\` from the container tokens (\`"$container-3xl"\`) and the rest
is margin. A form stops at its longest comfortable field, usually \`"$container-md"\` or
\`"$container-lg"\`. Reading measure is typography's.

## Sizes from content

Text and the containers around it \`hug\` or \`fill\`; translated strings grow, and short labels
grow most. Fixed pixels are for things with a real fixed size: an avatar, a thumbnail, a
sidebar. Bound a box with \`minWidth\` and \`maxWidth\` rather than fixing it.

## Collapse late, and say what moves

Check the page at the design system's breakpoints, or at \`390\` and \`1440\` with
\`get_screenshot\`'s \`width\`. Keep the wide layout as long as it genuinely fits. At each
breakpoint, something moves: a side panel becomes a sheet, columns stack, a table becomes a
list.

## The primary action stays reachable

At the end of a form, in the page header, or fixed to the bottom on a phone when the screen is
long. Keep it in the flow or in fixed chrome, away from the bottom edge of a pane that resizing
clips.

## Content bleeds, controls inset

Backgrounds, media and full-width tables may reach the edges. Text and controls stay inside the
page margins, \`16px\` or more on a phone. A full-width button on a phone keeps the margins and
its radius.

## One scroll region

The page scrolls, or one region of it does. A horizontal scroller lets the next item peek
\`16–32px\` past its edge, so it reads as scrollable.

## Density follows the task

Compact where the user works: tables, toolbars, editors. Open where they read or decide:
settings, onboarding, empty states.

## Before you finish

| You see | Fix |
| --- | --- |
| Text touching the edge at \`390\` | Page padding of \`16px\` or more |
| A paragraph or form stretched across \`1440\` | \`maxWidth\` from a container token |
| A button or label with a fixed pixel width | \`hug\`, with padding from the component |
| Columns squeezed unreadable at \`390\` | Stack them |
| A row of cards ending exactly at the scroller's edge | Size them so the next one peeks |
| Two nested regions that both scroll | One scroll region |
`,
} as const;
