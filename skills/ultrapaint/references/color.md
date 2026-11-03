# Colour

Colour is meaning first. Use the design system's semantic tokens for what a thing is, and reach
into a palette only when the semantic set has nothing for it.

Colour has exact answers, so compute them: [with the editor's tools: `read_design_system` | without: `design.tokens.json`] gives every token's value in
every theme. A contrast you did not compute is a guess.

Read `references/studies/color.md` when you colour a public page (a landing page, shop, portfolio or magazine). It holds the counts from 4,983 sites, how each character colours its grounds, accents and gradients, and recipes such as a dark product hero, a flood colour or a monochrome gallery.

## Tokens by role

Surfaces, text and borders come from semantic tokens: background, foreground, muted, border,
primary, destructive and their pairs. A palette colour (`"$color-blue-500"`) on a screen is a
decision the design system did not make; use one only where DESIGN.md's Colors section does.

The neutrals are the design system's, neutral or warm (`references/design-system/foundations.md`).
When the system's are blue-grey and its character is not cool, tell the user rather than
overriding them on one screen.

## A token only in its role

Pick a token for the job its name says, never for the value it has today. The border token used
as a text colour fades the day borders get lighter. When a role has no token (a status, a
category's hue, a tinted row), add it to the design system rather than borrowing one or dropping
what it says: [with the editor's tools: with `write_design_system`, | without: in DESIGN.md's tokens,] a line in DESIGN.md saying why,
and tell the user. A token the system has but gets wrong stays theirs to change: use it, and tell
them.

## One accent

The primary colour marks the primary action and a chosen option: a selected card, a switch that is
on, a checked box. The current place (the active navigation item, the active tab) takes the design
system's selected style, a neutral fill or a solid brand fill as DESIGN.md says; where the system
draws something solid, keep it solid. On a button the accent is the fill, with its foreground pair
for the label; accent text on a neutral button reads as a link. Headings, icons and borders stay
neutral.

In a product's own screens there is one accent, apart from category hues. On a public page, a second hue may join it
when it has one fixed job and keeps that job everywhere: categories, a promotion or data. Where the
content is photographs or work, the interface may take no hue at all and leave the colour to the content.

## Two text colours, clearly apart

The foreground is near-black, `15:1` or more against its background. A deep brand ink (navy,
forest green) counts as the foreground when it computes to `15:1`, and so does an off-white on a dark ground. Below that it is not the
foreground, whatever its role. Muted text sits as light as legibility allows: about `4.5–5.5:1`.
Compute both from [with the editor's tools: `read_design_system` | without: `design.tokens.json`]. When the muted token is darker than about `6:1`, the two
levels blur. Say so to the user, and set descriptions and metadata in muted all the same.

## Badges are neutral

A status or change badge (Paid, Active, ↗ 1.2%) is the system's Badge: a neutral fill that
differs from its card's surface, the foreground or muted text. A status may add a small coloured
dot inside it, a change its arrow; nothing else in it takes a colour. Blurred, the screen shows
no coloured block where a badge is. A filter for that status repeats the same dot.

## One colour, one meaning

A hue means one thing across the product, and hues within about `15°` of each other count as the
same one. If the accent means interactive, static text in it invites clicks.

## Status colours report status

Success, warning and destructive say that something happened or will. They stay off decoration
and off chart series. Categories (calendar events, tags) take their own hues from the palette;
one may be green or orange, in a shade that is not the status token. Each category keeps its
own tint; flattening them to one accent and grey loses what they say.

A secondary link (help, a handle in running text) is muted or foreground and underlined, not the
accent in bold.

## Text on a colour takes its pair

Text on primary takes primary-foreground, on destructive destructive-foreground: that pair is
what reads in every theme. Text over a photograph sits on a scrim or a solid surface.

## States are steps of one role

Hover, pressed, focus and disabled are the system's, steps of the same role, drawn through the
component's own states. Selected is the system's selected style: a neutral fill, or a solid brand
fill, never a pale wash of the accent. A state brings no new hue.

## Gradients

A gradient is light, not a surface. On a public page it is atmosphere: a glow behind a product
screenshot, a wash in a hero, a fade into the next band. It never fills navigation, cards or
controls, and it is never a state, so buttons stay solid. Text on a gradient is computed like text
on a photograph.

## Charts

The chart colours, in their order. Sequential data is one hue from light to dark; diverging data
is two hues around a neutral midpoint. One series is often one hue: the current period solid, the
previous dashed, a forecast hatched. When the styling tells the series apart, there is no legend;
a tooltip names what is under the pointer.

## Every theme

A fill that works on light may vanish on dark. For every pair you set, compare the two tokens'
values in each theme the design system has.

## Before you finish

| You see | Fix |
| --- | --- |
| A hex or `rgb()` value in `fill`, `color` or `border` | The semantic token for that role |
| A palette token in a component's colours | The semantic token it stands for |
| A blue-grey neutral the character does not ask for | A neutral or warm one; if the system's own is blue-grey, tell the user |
| The accent on headings, icons or dividers | Neutral; the accent stays on the action and the selection |
| A second hue with no fixed job, or any second hue in a product's own screens | Remove it |
| A badge on a tinted green or red fill | The neutral Badge; at most a coloured dot inside it |
| A selected item on a pale tint of the accent | The system's selected style: neutral, or solid brand |
| A gradient on navigation, cards, buttons or a state | A solid fill; a gradient only lights the page |
| A foreground ink below `15:1` | The foreground token; if the token itself is below, tell the user |
| A legend for series the line styles already tell apart | Remove it |
| A status colour as decoration or a chart series | Neutral, or the chart colours |
| Hard-coded white or grey text on a coloured fill | The fill's foreground pair |
