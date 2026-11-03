# Importing a Figma file

**Import a Figma file…** (in Design system's Sync view, the canvas list or a
canvas's right-click menu) takes a `.fig` file (File → Save local copy in Figma) and opens Sync on
it. Its tokens come first: variables mode by mode (Light and Dark become your themes), aliases
followed, and colour and shadow styles, named the way your code names tokens
(`Colors/Primary/500` is `color-primary-500`), compared with your code as above.

Then **Map and write the pages** opens a thread with `/import-figma` in its composer. The agent
decides, component by component, what each Figma component becomes: one of the system components,
with its variants and text properties mapped to props; a custom one, kept as the layers it is
made of; or left out. Where the names do not settle it, the agent asks you in the thread, with
the likely candidates to pick from, and carries on with your answers. Each frame is then written
as a page at a route that fits its name, with its pictures in the space's `assets/`, colours
that are tokens written as tokens, and the agent looks at it and mends what the rules could not
carry over.

Auto-layout becomes rows and columns, text keeps its font, image fills become images, icons
become SVG files. Free-positioned layers are stacked in reading order, and the import says so.
Exporting back to Figma is not done yet.
