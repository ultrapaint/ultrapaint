# Review

What a reviewer runs against a finished screen or page, row by row. Each row is something you can
see in the picture or read in the code, and what fixes it. The rules behind the rows are the
core's (`SKILL.md`); the kind's file and each concern's file add their own Check tables.

Go through every row against every element of the section: each text, each icon, each control,
each gap. A row that matches is a finding: report where it is, the row's id and words, and its fix.

## Words, and what is shown twice

| Id | You see | Fix |
| --- | --- | --- |
| W1 | A heading, caption or description that repeats what is beside it | Remove it |
| W2 | A hint about a selection or mode shown when there is none | Show it only in that state, beside the action it affects |
| W3 | An item doing another kind of thing in a list, or in a group of one | Move it where that kind of thing lives |
| W4 | A sentence explaining how to use a control whose label already says it | Remove it; keep a requirement the label can't carry (a password's rule) |
| W5 | An intro, eyebrow or subtitle on a screen whose purpose is plain | Remove it; keep an eyebrow only for a fact the heading cannot hold (SKILL.md, Restraint) |
| W6 | A heading over a group its content already names | Remove it; a surface or space holds the group |
| W7 | An icon on every label, a box around one element, a divider between separated groups | Remove the decoration |
| W8 | Navigation or borders heavier than the content | Lighter chrome |
| W9 | An item under a group starting at another column | One column for the group's items |
| W10 | A value the window already shows elsewhere (a size on its frame, a count on its group, a title its nav item names) | Once, where it is read or set |
| W11 | Lorem ipsum, "Title", "Item 1" | Real copy |
| W12 | A legend on a chart whose series are labelled on it, a title over a block its tabs already name | Delete it; shrinking is not enough |
| W13 | "vs last year" after each change when the period is stated once above them, "Enabled" beside a switch, "17 rows" under a table, "5 of 5" over a stepper, a title over a toolbar | Remove it: the thing beside it already says so |
| W14 | A badge on every card, or one thing marked three ways (tab, fill, border) | One badge, only for a state nothing else shows |
| W15 | "Thousands of happy customers" | The number |
| W16 | Title Case On Buttons | Sentence case |
| W17 | "Submit", "OK" or "Yes" on a consequential action | Verb and object: "Send invoice" |
| W18 | "Click here", "Learn more" alone | Name the destination, or make the card the link |
| W19 | Labels of one list in different forms (nouns beside a sentence fragment) | One form |
| W20 | One fact formatted two ways in two lists (a day here, a time there) | One format |
| W21 | A line under an object's title holding a sentence of data, or a fact the page shows elsewhere (the total, the payment, the customer's name again) | One or two facts that tell the object apart, none repeated; or no line |
| W22 | Facts a task needs only sometimes (an ID, the build machine, sizes, a job code, a passed check) in view at rest | One "Details" disclosure at the end of the side column, or another tab |
| W23 | More than three actions in an object's header at rest | The primary and the two its state makes most frequent; the rest in its ⋯ menu |
| W24 | A line under a label that a user who knows the label would not miss, or one there because its neighbours have one; most rows of a list with a line is the sign | Remove it; keep a consequence, a scope, a constraint, why it is unavailable, or the current value |

## Hierarchy

| Id | You see | Fix |
| --- | --- | --- |
| H1 | Two buttons in the primary variant on one screen | Keep the one the screen is for; the other becomes secondary |
| H2 | The title repeated in the first paragraph or a card heading | Cut the repeat |
| H3 | A small label above a heading ("Features", "School · Desio") | Cut it; what it adds goes below the heading or in the page header |
| H4 | A group of navigation items or settings rows under a bold heading | A small label: the group's name, quiet beside its rows, a step above their details (`references/typography.md`) |
| H5 | A list of choices all set alike, none leading | The likely one leads; the rest fewer, or behind search |
| H6 | The key figure below its metadata | Move it to the top of its group |
| H7 | A card in a card in a card | Replace the inner containers with a heading and a gap |
| H8 | Delete beside Save in the same style | Destructive variant, moved apart |

## States

| Id | You see | Fix |
| --- | --- | --- |
| S1 | Only the loaded state of a screen with data | Draw empty, loading and error |
| S2 | A spinner in place of the whole page | Skeletons in the page's layout |
| S3 | A banner at the top for one field's error | The error under the field |
| S4 | A disabled submit with no reason given | Enabled; say what is missing on submit |
| S5 | A name that only ever fits | One that wraps or truncates, drawn |
| S6 | More than four suggestions in an empty state | Three or four for the moment; the rest in search or a command |
| S7 | A loading state that only success ends | The error in its place, with a retry |
| S8 | A field that saves on blur with nothing shown | Saving and saved beside it, its error under it |
| S9 | An empty state that doesn't say it is empty | "None yet" and the action that fills it |
| S10 | A destructive action beside safe ones, in their style | Apart: the row's menu or the destructive variant, with its undo |
| S11 | A confirm for what can be undone | Act, and offer the undo; a confirm's title names what is lost |

## Usability

| Id | You see | Fix |
| --- | --- | --- |
| U1 | A dialog, step or mode left only by finishing it | Cancel, Back, Escape, a visible exit |
| U2 | The same action named, styled or placed two ways across screens | One label, one variant, one place |
| U3 | Free text where the valid set is known | A picker, a select, a stepper |
| U4 | A format rejected that could be read | Accept it, normalise it |
| U5 | A decision whose facts are on another screen | Bring them beside it |
| U6 | A daily tool's frequent action with no shortcut | Give it one, shown in its menu item |
| U7 | Rows that look alike and do different things on click | One click, one meaning; what differs gets its own control |
| U8 | A row's actions shown only under the pointer | The one it is for in view at rest; the rest in its menu |
| U9 | An action that moves or changes form once used (a button when empty, a + once not) | One place and one form, empty or not |

## Icons

| Id | You see | Fix |
| --- | --- | --- |
| I1 | Icons from two packages on one screen | The design system's set only |
| I2 | Emoji standing in for icons | The set's glyph, or the word |
| I3 | A brand mark redrawn or tinted to the accent | Its official form |
| I4 | An accent-coloured icon beside a neutral label | The label's colour |
| I5 | An icon-only button without a tooltip | Add the tooltip and the accessible name |
| I6 | The same icon for two actions | One icon per meaning |
| I7 | Icons on headings, eyebrows, child rows, names or plain links | Remove them |
| I8 | An icon before every bullet of a list | Remove them; checks only where the list compares |
| I9 | A folder before every item of a file tree | The chevron alone |
| I10 | Icons on some rows of a menu and not others | All or none |
| I11 | Icons on several buttons of a page header | Text only; an icon stays on at most one |
| I12 | An icon the window uses elsewhere for another action (undo, for a restore) | One icon per meaning across the window |
| I13 | An icon and its tooltip that say different things (a back arrow named Close) | One meaning: change the icon or the name |

## Type

| Id | You see | Fix |
| --- | --- | --- |
| T1 | A text sized or weighted by a raw number | A text style of the system |
| T2 | Text in the machine's fallback face | Load the product's face |
| T3 | A serif in navigation, labels, controls or tables the user did not ask for | The product's sans |
| T4 | On a product screen, four sizes without a display figure, or five or more | Merge to the nearest of three |
| T5 | A level 3 heading larger than its level 2 | A smaller style for the lower level |
| T6 | A `28px` bold title in a top bar or over a small form | Body size, one weight up |
| T7 | A display headline lighter than its character (a thin face for a playful brand, `400` for a technical product) | Technical `600`, humanistic `500`, expressive `800` |
| T8 | Control text in bold, or navigation all in the foreground colour | Medium, muted; the current one in the foreground |
| T9 | A field label at the same weight as its description, or muted | Semibold, the foreground |
| T10 | Field labels of fields, checkboxes, groups and table rows in different styles | One field-label style for all |
| T11 | A paragraph wider than about 75 characters | A max width on it or its column, about `65ch` |
| T12 | A three-line description at line height `1.1` | `1.4` or the body style |
| T13 | A light weight at `14px` | `400` or heavier |
| T14 | Uppercase display of `40px` and up tracked wide | `0` or tighter |
| T15 | A description under a heading in the foreground colour | Muted |
| T16 | Group labels in the same small muted style as the counts or descriptions under them | Weight or space above the label; muted plays at most two roles in a region |
| T17 | `...` or straight quotes in prose | `…` and curly quotes |
| T18 | Capitals typed into the text | Sentence case, uppercase from the style |
| T19 | Names in a list in the body weight, as light as their metadata | The label style |
| T20 | Tabular figures on a number read alone (a size, a date) in a face whose 1 is narrow | Proportional; tabular only in columns compared down |

## Colour

| Id | You see | Fix |
| --- | --- | --- |
| C1 | A hex or `rgb()` value on a surface, a text or a border | The semantic token for that role |
| C2 | In a detailed system, one property's token on another (a `background-color-*` on text) | The token of that property, the same meaning |
| C3 | A palette token in a component's colours | The semantic token it stands for |
| C4 | A blue-grey neutral the character does not ask for | A neutral or warm one; if the system's own is blue-grey, tell the user |
| C5 | The accent on headings, icons or dividers | Neutral; the accent stays on the action and the selection |
| C6 | A second hue with no fixed job, or any second hue in a product's own screens | Remove it |
| C7 | A badge on a tinted green or red fill | The neutral Badge; at most a coloured dot inside it |
| C8 | A selected item on a pale tint of the accent | The system's selected style: neutral, or solid brand |
| C9 | A gradient on navigation, cards, buttons or a state | A solid fill; a gradient only lights the page |
| C10 | A foreground ink below `15:1` | The foreground token; if the token itself is below, tell the user |
| C11 | A legend for series already labelled at their lines | Remove it |
| C12 | A status colour as decoration or a chart series | Neutral, or the chart colours |
| C13 | Hard-coded white or grey text on a coloured fill | The fill's foreground pair |

## Surfaces, borders and radius

| Id | You see | Fix |
| --- | --- | --- |
| F1 | A shadow on a surface of another level | The level's own surface and shadow |
| F2 | A shadow on every card in a list | Flat cards with a border |
| F3 | A popover floating apart from its trigger | Attach it, `4px` off the edge |
| F4 | A surface inside another of nearly the same tone, in either theme | One tone step apart, flush, an edge only where they meet |
| F5 | A card's chrome and its content panel on one tone, split by a hairline | The chrome a step down, the panel a step up inside it |
| F6 | A card and the button inside it with the same radius | Outer radius less the padding |
| F7 | A border colour as hex | The border token for its role |
| F8 | Buttons and fields with different radii | The default radius for both |
| F9 | Rounded corners on a full-bleed image or a bare table | Square |
| F10 | A guide or rule drawn across a selected row's fill | It stops at the fill |

## Spacing

| Id | You see | Fix |
| --- | --- | --- |
| G1 | A raw pixel value in a gap or a padding where a spacing token exists | The nearest step of the scale |
| G2 | A gap between groups under twice the gap within them, measured between the text; under three times between stacked groups of rows in a panel or a sidebar | Widen it to twice or more; three times in a panel or a sidebar |
| G3 | A divider between the groups of a form | Drop it; space separates them |
| G4 | Two jobs split only by a bold heading and a divider | A quiet surface for each |
| G5 | A card or dividers around a short list of toggles | Bare rows |
| G6 | A rule under a breadcrumb, above a copyright line, or a box around a table already on a surface | Remove it |
| G7 | Every section of a page boxed in a card | Remove the boxes; type, image and position group |
| G8 | A card padded `16` on a public page | `24–32` |
| G9 | Siblings spaced by their own margins | The parent's `gap` |
| G10 | A card padded `24` on top and `16` on the sides | One value on every side |
| G11 | One relationship at two distances (the gap after a chevron, a dialog's padding against DESIGN.md) | One step |

## Layout

| Id | You see | Fix |
| --- | --- | --- |
| L1 | Text touching the edge at `390` | Page padding of `16px` or more |
| L2 | A paragraph or form stretched across `1440` | A max width from a container token |
| L3 | A public page squeezed into the prose container | A page container of about `1200–1300px`; the prose container only for prose and forms |
| L4 | Centred and left edges inside one section | One alignment per section; only the hero may differ |
| L5 | A button or label with a fixed pixel width | Let it hug its text, with padding from the component |
| L6 | A row of cards ending exactly at the scroller's edge | Size them so the next one peeks |
| L7 | Two nested regions that both scroll | One scroll region |
| L8 | Suggestions or filters away from the field or list they change | Against it: starters above the composer, filters above the list |

## Components

| Id | You see | Fix |
| --- | --- | --- |
| K1 | A row with a fill, a radius and a text that looks like a button | A Button instance |
| K2 | A system component restyled by its fill, radius or border | A variant or a prop |
| K3 | "Button" or "Label" left from an example | A real label |
| K4 | An outlined select inside a table row or a sentence | Text and a chevron |
| K5 | A "Copy" button beside a link field | The copy action inside the field's end |
| K6 | A switch in front of its label | Label left, switch at the right edge |
| K7 | A field's hint as text in a box, or an icon laid over a field | The field's placeholder and icon slot |
| K8 | A change badge under its value, or captioned "vs last year" | Small, at the row's far right, no caption |

## Accessibility

| Id | You see | Fix |
| --- | --- | --- |
| A1 | Muted text at `12–14px` on a tinted surface | Compute it; the foreground colour if it fails |
| A2 | Status shown by colour alone | Add an icon or a word |
| A3 | An icon button under `24px` square | Pad it to the target size |
| A4 | A field with only a placeholder | A visible label |
| A5 | Heading levels jumping from 1 to 3 | Levels in order |
| A6 | An informative image with no `alt` | Describe its meaning |
| A7 | A fixed height on a box of text | Let it hug its text, or a minimum height |
| A8 | A checkbox or chevron whose target is its `16px` box | `24×24` by padding |

## Motion

| Id | You see | Fix |
| --- | --- | --- |
| M1 | An entrance from `scale(0)` | `scale(0.95)` with opacity `0` |
| M2 | `ease-in` on an interface element | The entering curve above |
| M3 | A menu or popover over `300ms` | `150–250ms` |
| M4 | Motion on a keyboard shortcut | None |
| M5 | A popover growing from its own centre | Grow from the trigger |
