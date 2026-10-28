---
name: motion
description: "Motion explains a change: where something came from, where it went, what it is connected to. Decide in order whether it moves at all, why, then how; often the right answer is no animation. Use when designing or reviewing an interface's motion."
---

# Motion

Motion explains a change: where something came from, where it went, what it is connected to.
Decide in order whether it moves at all, why, then how; often the right answer is no animation.

Curves and durations are the design system's `motion` tokens, or the values below when it names
none, used exactly as written: `cubic-bezier(0.23, 1, 0.32, 1)` is not `ease-out`.

The canvas is still: a design shows the end state of each transition. Write the motion in a text
node on the canvas beside the page, one line per transition: trigger, what moves, duration,
curve. In code it ships as written.

## 1. Should it move

| How often the user sees it | Motion |
| --- | --- |
| Hundreds of times a day: shortcuts, the command palette | None |
| Tens of times a day: hover, list navigation, tabs | Colour or opacity at `150ms` or less, or none |
| Occasionally: menus, dialogs, drawers, toasts | Standard |
| Rarely: onboarding, a first success | Room for delight |

What the keyboard triggers changes instantly.

## 2. Name its purpose

Feedback, origin (where it came from or went), state, continuity (content that would otherwise
jump), explanation (onboarding and marketing only) or delight (the rare tier only). No purpose,
no animation. Data the user is reading stays still.

## 3. Move transform and opacity

Animate `transform` and `opacity`; `height` only for an accordion. Enter from `scale(0.95)` and
opacity `0`. A menu, popover or tooltip grows from its trigger, a dialog from the centre, a
sheet slides from its edge, a toast from its corner.

## 4. Pick the curve and duration

| Situation | Curve |
| --- | --- |
| Entering or leaving | `cubic-bezier(0.23, 1, 0.32, 1)` |
| Moving or morphing on screen | `cubic-bezier(0.77, 0, 0.175, 1)` |
| A drawer or sheet | `cubic-bezier(0.32, 0.72, 0, 1)` |
| Hover and colour | `ease` |
| Spinners, progress, marquees | `linear` |

| Element | Duration |
| --- | --- |
| Press, hover, toggle | `100–160ms` |
| Tooltip, small popover | `125–200ms` |
| Menu, select | `150–250ms` |
| Dialog, sheet | `200–300ms` |

Interface motion stays under `300ms`. Exits retrace the path they came in on and run shorter:
`150ms` where the entrance took `200–250ms`. Items entering together stagger `30–80ms` apart,
and only on the rare tier.

## 5. Keep it interruptible

Whatever the user can trigger twice in a second uses a transition, which turns back from where
it is: toggles, toasts, hovers. Keyframes are for one-shot sequences and loaders. Drags and
gestures use a spring, with bounce only for drag-to-dismiss.

## 6. Reduce and gate

Under reduced motion, movement becomes a short opacity fade and comprehension aids stay. Hover
motion runs only where the device hovers. Every state a motion shows is also visible without it,
as a colour, an icon or a label. Nothing flashes more than three times a second.

## Before you finish

| You see | Fix |
| --- | --- |
| `transition: all` | Name each property |
| An entrance from `scale(0)` | `scale(0.95)` with opacity `0` |
| `ease-in` on an interface element | The entering curve above |
| A menu or popover over `300ms` | `150–250ms` |
| Motion on a keyboard shortcut | None |
| A popover growing from its own centre | Grow from the trigger |
| `width`, `height`, `top` or `left` animated | `transform` |
| A designed transition with no note on the canvas | Write the line beside the page |
