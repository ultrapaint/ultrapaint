---
name: color
description: "Colour is meaning first. Use the design system's semantic tokens for what a thing is, and reach into a palette only when the semantic set has nothing for it. Use when designing or reviewing an interface's color."
---

# Colour

Colour is meaning first. Use the design system's semantic tokens for what a thing is, and reach
into a palette only when the semantic set has nothing for it.

Colour has exact answers, so compute them: [with the editor's tools: `read_design_system` | without: `design.tokens.json`] gives every token's value in
every theme. A contrast you did not compute is a guess.

## Tokens by role

Surfaces, text and borders come from semantic tokens: background, foreground, muted, border,
primary, destructive and their pairs. A palette colour (`"$color-blue-500"`) on a screen is a
decision the design system did not make; use one only where DESIGN.md's Colors section does.

## A token only in its role

Pick a token for the job its name says, never for the value it has today. The border token used
as a text colour fades the day borders get lighter. When a role has no token, tell the user
rather than borrowing one.

## One accent

The primary colour marks the primary action and a chosen option: a selected card, a switch that is
on, a checked box. The current place (the active navigation item, the active tab) takes the design
system's selected style, a neutral fill or a solid brand fill as DESIGN.md says; where the system
draws something solid, keep it solid. On a button the accent is the fill, with its foreground pair
for the label; accent text on a neutral button reads as a link. Headings, icons and borders stay
neutral.

## Two text colours, clearly apart

The foreground is near-black, `15:1` or more against its background. Muted text sits as light as
legibility allows: about `4.5–5.5:1`. Compute both from [with the editor's tools: `read_design_system` | without: `design.tokens.json`]. When the muted token
is darker than about `6:1`, the two levels blur; say so to the user, and set descriptions and
metadata in muted all the same.

## Badges are neutral, their mark is coloured

A status or change badge (Paid, Active, ↗ 1.2%) sits on a neutral fill that differs from its
card's surface (a muted grey on a white card), with the foreground or muted text; only its small
mark is coloured: the green dot, the green arrow. Blurred, the screen shows no coloured block
where a badge is. A filter for that status repeats the same dot.

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

Hover and pressed are a shade of the same fill: the hover tokens when the system has them, the
fill at `90%` opacity when it has not. Selected is the accent's subtle fill, focus is the ring
colour, disabled is `50%` opacity. A state brings no new hue.

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
| The accent on headings, icons or dividers | Neutral; the accent stays on the action and the selection |
| A badge on a tinted green or red fill | A neutral fill; only its dot or arrow is coloured |
| A legend for series the line styles already tell apart | Remove it |
| A status colour as decoration or a chart series | Neutral, or the chart colours |
| Hard-coded white or grey text on a coloured fill | The fill's foreground pair |
