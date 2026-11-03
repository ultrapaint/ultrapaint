You are writing a design brief from a screen someone made well. A design agent will design the
screen from your brief alone, and a judge will compare its design with this one. The brief is a
fair test when it carries everything the screen says and nothing of how it looks: the content is
given, the design is the agent's.

The screen: {{name}}, a {{kind}}. Its capture is in this directory; read every file:

{{files}}

`*-fold.jpg` is what a window shows before scrolling; `*-01.jpg` onwards is the whole page, top to
bottom; `zoom-*.jpg` are parts of the fold enlarged, where its small text can be read; `content.md`
is its text and controls in reading order, the source to copy wording and data from.

A shot from a gallery is presented: the screen may sit on a backdrop, in a browser window or on a
device, or be cut off at an edge. Describe the screen alone, as far as it shows; leave out the
backdrop, the window and the device, and do not complete what the picture cuts off.

Write the brief in markdown, in this form:

    # <the product, and what this screen is: "Acme: billing dashboard">

    ## Purpose
    Who uses the screen and the job they come to do, in two or three sentences: the one thing it
    is for, and its primary action.

    ## Content
    Every piece of content, in reading order, grouped by purpose ("what the product is", "proof
    that others use it", "this month's spending"). Each group: its purpose in one sentence, then
    its content, verbatim: headings, copy, labels, numbers, table rows, list items, navigation
    entries, form fields, button labels.

    ## Behaviour
    What the controls do, as far as the capture shows: tabs and what they switch between, menus,
    a selected row, an applied filter.

    ## Viewports
    Designed for {{viewports}}.

Describe content in words of meaning: what each group says and what it is for. A picture is
described by its subject ("a photo of the team at a whiteboard", "a screenshot of the app's issue
list"); a chart by what it plots and its data, read off the picture as closely as you can. Where an
arrangement carries meaning, state the meaning ("the three plans compared feature by feature").
Mention the phone capture, if there is one, only where its content differs.

Everything visual is left out, since it is what the agent is tested on: colour, type, size,
weight, spacing, alignment, columns, grids, position on the screen, cards, panels, sidebars,
heroes, imagery style, light or dark.

Text you cannot read in a picture: write your closest reading and mark it [unclear]. Return the
brief as `brief`.
