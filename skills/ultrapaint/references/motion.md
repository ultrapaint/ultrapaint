# Motion

Whether a change moves, and when it does, the curve, duration, stagger and gating to write down
for it. Curves and durations are the design system's motion tokens, or the values below, used
exactly as written.

## Writing it down

A static design shows the end state of each transition. Write each one as a line beside the
design: trigger · what moves · duration · curve ("Open · menu · opacity 0→1, scale(0.95)→1 ·
`200ms` · `cubic-bezier(0.23, 1, 0.32, 1)`"). In code it ships as written.

## Should it move

| How often the user sees it | Motion |
| --- | --- |
| Hundreds of times a day: shortcuts, the command menu | None |
| Tens of times a day: hover, list navigation, tabs | Colour or opacity, or none |
| Occasionally: menus, dialogs, drawers, toasts | Standard |
| Rarely: onboarding, a first success | Room for delight |

What the keyboard triggers changes at once: a selection moved by the keyboard does not fade. The
content shows without waiting: no intro holds it back and no preloader runs unless a 3D scene must
load. Smooth-scroll libraries and scroll-linked motion only when the brief asks for them.

Each motion names its purpose: feedback, origin (where it came from or went), state, continuity
(content that would otherwise jump), explanation (onboarding and marketing only) or delight (the
rare tier only). Data the user is reading stays still, with no loop behind it.

## What moves

`height` is animated only for an accordion. A dialog grows from the centre, a sheet slides from
its edge, a toast from its corner. Content entering a public page rises from `translateY(16–24px)`
with opacity `0`, once, as it scrolls into view, never replaying on the way back up. Bigger moves
further and longer: small items `16px` in `400ms`, blocks `24px` in `500ms`, hero lines `40px` in
`800ms`. A hover names each property (`color`, `background-color`, `opacity`); `transform` only on
a card or a pressed button.

## Curves

| Situation | Curve |
| --- | --- |
| Entering or leaving | `cubic-bezier(0.23, 1, 0.32, 1)` |
| Moving or morphing on screen | `cubic-bezier(0.77, 0, 0.175, 1)` |
| A drawer or sheet | `cubic-bezier(0.32, 0.72, 0, 1)` |
| Hover and colour | `ease` |
| Spinners, progress, marquees | `linear` |

The keywords are other curves: `ease-out` is `cubic-bezier(0, 0, 0.58, 1)`, `ease` is
`cubic-bezier(0.25, 0.1, 0.25, 1)`, `ease-in` `cubic-bezier(0.42, 0, 1, 1)`. An interface element
never enters on `ease-in`. A system that names one house curve uses it for every entrance and
hover.

## Durations

| Element | Duration |
| --- | --- |
| Press, hover, toggle in a product | `100–160ms` |
| Colour hover on a public page | `150–200ms` |
| Tooltip, small popover | `125–200ms` |
| Menu, select | `150–250ms` |
| Dialog, sheet | `200–300ms` |
| Content entering a public page on scroll | `500–800ms` |
| A spinner's turn | `1000ms`, `linear` |

Only content entering a public page passes `300ms`. Exits retrace the path they came in on and run
shorter: `150ms` where the entrance took `200–250ms`.

## Stagger and loops

- **Stagger** only on the rare tier (a scroll reveal, seen once, belongs there): `80ms` between
  blocks, `20ms` between the words of a display headline, at most six steps, the whole cascade
  within `500ms`.
- **A marquee or ambient drift**: `linear`, `20000ms` or more per cycle, slow enough to read; on a
  public page only, one per screen, paused off screen. Loops side by side fall out of step by
  duration, not delay; a negative delay starts them mid-cycle on first paint.

## Interruptible

Whatever the user can trigger twice in a second (a toggle, a toast, a hover) is a CSS transition,
which turns back from where it is. Keyframes are for one-shot sequences and loaders. Drags and
gestures take a spring, with bounce only for drag-to-dismiss.

## Reduced and gated

Under `prefers-reduced-motion: reduce`, movement becomes a short opacity fade and what aids
comprehension stays; opacity-only fades may stay. Hover motion runs only under
`@media (hover: hover)`. Every state a motion shows is also visible without it, as a colour, an
icon or a label. Nothing flashes more than three times a second.

## Check

| You see | Fix |
| --- | --- |
| A designed transition with no line written for it | Trigger · what moves · duration · curve |
| `transition: all` | Name each property |
| `ease-out` written where the entering curve was meant | `cubic-bezier(0.23, 1, 0.32, 1)` |
| `width`, `height`, `top` or `left` animated | `transform`; `height` only for an accordion |
| An intro or preloader holding the content back | Show the content at once |
| A selection fill that fades as the keyboard moves it | Instant; a fade only on hover |
| A cascade running past `500ms`, or a stagger in a product's daily screen | Shorter steps, or none |
| A scroll reveal that replays on scrolling up | Once |
| Movement still running under reduced motion | An opacity fade |
| Hover motion on a touch device | Gate it on `(hover: hover)` |
