/** Built-in skill. The file is the skill: its heading is the title, the paragraph after it the summary. */
export const layout = {
  name: "layout",
  text: `# Layout

A page is a few large regions on a grid, and it holds at every width the product supports.
Decide the regions first, then fill them.

- Build a page from a few large pieces: a header, a navigation, a main column, maybe a side
  panel. Compose them from rows and columns, then fill them with components.
- Content sits in columns of the grid. Edges of regions line up with each other down the page,
  and gutters are one spacing step everywhere.
- Width has limits. A reading column stops at about seventy characters, a form at its longest
  comfortable field, a page at the design system's container width; the rest is margin. Use the
  container tokens ("$container-3xl") for a max width rather than inventing one.
- Design at the breakpoints the design system names, smallest first when the product is used
  on phones. Say what moves at each: a side panel becomes a sheet, columns stack, a table
  becomes a list. Do not just shrink.
- The primary action stays reachable: at the end of a form, in the header of a page, fixed at
  the bottom on a phone when the screen is long.
- Scroll in one place. A page scrolls, or a region of it does; nested scrolling areas that fight
  for the wheel are a bug.
- Dense where the user works, open where they read. A data table can be compact; a settings
  page and an onboarding step cannot.
`,
} as const;
