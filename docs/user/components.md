# Components

Everything you place is a component ([ADR 0041](../adr/0041-system-and-app-components.md)), of
two origins, each kept as a file of the designs directory, `components/<Name>.component.json`:

- **System components** are Ultrapaint's own, on Base UI
  ([ADR 0040](../adr/0040-the-editors-own-primitives.md)): Button, Badge, Spinner, Avatar, Card,
  Separator, Input, Textarea, Checkbox, Switch, Tabs, Select, Menu, Popover, Tooltip, Dialog and
  Toast. Their behaviour is fixed; their look is your design system's.
- **App components** are yours, built from system components and other app components: a
  pricing card, a site header.

Layout, text and image nodes are **elements**, inserted from the **+** at the head of the tools.
**Components**, on the rail, lists the App components, then the System components, as a list or
as thumbnails: a click inserts one into the selection, a drag places it anywhere, **↗** opens its
board, and **+ New** makes an empty app component and opens its board. Colours, type and spacing
are in the **Design System**.

**Design System mode.** Under the project, a toggle switches between **Canvas** (the pages,
with Agents, Layers, Components and Changes on the rail) and **Design System** (Agents,
**Foundations**, **Components** and Changes). Design System mode shows the item picked alone on a
canvas of its own, blue-tinted and dotted so that it is never taken for the pages: its **boards**,
drawn by the renderer that draws the pages from the design system and the component files, so
they cannot drift from them. The camera is the canvas's (wheel, pan, zoom), an item first seen
fits between the panels, the URL says where you are (`?view=library&item=Button`) so a reload or a
link lands on it, and **Canvas**, picking a canvas, or the browser's back returns to the page as it
was. On a board the left panel is the list to go from item to item (Components' **Overview** shows
every component), and the right panel is the inspector of what is open and picked there. Its
title has the chat button the element toolbar has on a page: what is picked (a token, a text
style, a guideline, a component at a variant and a state) goes to the chat, and an agent is told
what it is, what it is now and the file it is kept in.

Select a component and the inspector lists its props and its **slots** — a Dialog's trigger,
header, content and footer — with what fills each and a **+** that adds a text, a row, a column
or a button to it; Layers shows the slot each child fills. A row in a dialog's footer, aligned
right, with two buttons, is a standard footer.

Each frame is a page of its own: a select opens inside it, a dialog's backdrop covers it alone,
and a dialog is a sheet at the bottom of a narrow frame. While you design, an overlay is drawn
open where its `open` prop says, and nothing in the frame takes the pointer; in the prototype and
with the interact tool the system components behave (a menu opens, items take the hover, Escape
and a click outside close it), each in its own frame.

**A system component's look is yours.** Its board in Components draws it in every variant and
every state at full size (hover, focus, disabled, open, checked, highlighted…), the members and
the states named, and a board for each further axis (Button's sizes); the interact tool makes
hover and press live there. It is in its **default look** (over your tokens) until you **take the
look over** (in the inspector, or its "…"), which starts its file from the default's values. Click
a cell to pick its place, or pick a Variant and a State in the inspector: both together set that
state in that variant alone (an outline button's hover), over the state's own values, and a field
left empty says what it takes and from where (the state, the variant, the base or the default
look). A value is drawn on every board and page as it is typed or gone through in a field's list,
and a field committed is one step you can undo. The
fields set: its fill, text, border, radius, padding (per side), size, gap, shadow,
and how it lays out what it holds (direction, alignment, order); a value can be any CSS over your
tokens' variables, a hover's `color-mix()`. It can leave out an optional
part (a dialog's close, a card's description), give a slot content for when an instance gives it
none, and draw a Select's or a Menu's items from nodes of yours (**Use selection**). **Reset to
default look**, in its "…", removes the file. **Implement** has an agent give your application's own component that
look, in whatever library it is written with. A component that adds behaviour, or takes away a
trigger, a popup or an item, is an app component built on the system one.

**App components.** Select part of a page and choose **Make an app component…** in its menu: it
becomes a component, and an instance of it takes its place. Double-click an instance (or **Edit
component**) to edit it in place: the rest of the page dims, what you select and change is the
component's, and every instance follows. There the inspector adds **properties** — a text, yes or
no, a choice, an image — or **exposes** a field of the node selected as one (its text, whether it
shows, its picture, a prop of a component inside it), and makes a container a **slot** that an
instance's children fill. A choice's members are **variants**: pick one in the banner under the
canvas and your edits land on it alone, and an edit made in a view of another width lands at its
breakpoint, which every instance shows at that width. Layers lists the component's tree while
you edit it. Escape, or **Done**, goes back to the page. An instance's
properties are its props in the inspector; **Detach** turns it back into plain nodes. Renaming a
property or one of a choice's members, or taking one out, follows into its variants and every
instance's props, in one step you can undo; two properties, slots or members cannot share a name.
**Implement** writes an app component as a component of your application, a prop for each
property and children for its slots. Its board in Components draws each of its variants side by
side: a click picks one, a double-click edits the tree in place there (Layers lists it, the edits
landing on that variant), and the inspector lists its properties, variants (with how many fields
each overrides), slots, where it is used and its notes.

A page made before, with your application's own components, draws each of them as a stand-in.
**Sync** offers to bring the designs up to date in one step you can undo: a component is matched
by its name (shadcn's `DropdownMenu` is the Menu), its variants, children and text are kept, and a
compound component's parts (`DialogFooter`, `CardHeader`) fill the system component's slots; specs
and draft components from before become component files. A stand-in's menu has **Replace with a
system component** for one at a time.
