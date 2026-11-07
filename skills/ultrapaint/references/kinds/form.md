# Forms

The anatomy of sign-in, sign-up, reset and verify pages, onboarding steps and contact forms, and
the parts any form reaches for: field rows, a code, a password's rules, choice cards.

## The page

- **Split screen** (the default on a wide screen): the form column, about `360px` (`340–480px`),
  centred in its half; the logo pinned top left; the legal line or the switch-flow line pinned
  to the bottom. The other half holds a photograph, one testimonial (a large quote, then name,
  role and company) or a live preview of the product.
- **Single column**: the same form column centred on the page, the logo above it.
- On a phone the second half goes.
- Spacing: padding `32px`, fields `16px` apart, groups `32px`.

## Fields

- A field's width follows its expected length. Fields that share a row size by what they hold:
  town, region and postcode wide, narrow, narrow; expiry and CVC side by side.
- Helper text carries a rule or live data (the password's rules, an available balance), never
  how to use the field.
- The placeholder shows an example of the format: `name@example.com`, never "Enter your email".
- Repeated inputs of one kind (inviting several emails) share one label above the stack.

## Actions

- The primary is full width, as wide as the fields, at the form's end.
- Other ways in follow it: one full-width outline button per provider stacked under it, or a
  row of equal logo-only buttons after an "or" set in a rule. A word in a rule ("or") stands in
  for a heading.
- "Remember for 30 days" and "Forgot password" share one row, one at each end.
- The switch between flows ("Already have an account? Log in") is one centred muted line with
  the link underlined.
- While submitting, a spinner inside the primary keeps its label and its width.
- On a long form on a phone, the primary stays reachable, fixed to the bottom; a full-width
  button keeps the page's margins and its radius.

## Password

- Its rules as a checklist under the field, each check filling as it is met, or a meter of four
  segments with one word ("Strong"); not both.

## One-time code

- Four or six square cells, the six split three and three by a dash. Digits in the foreground;
  the active cell takes the focus ring and a caret; an empty cell is blank or holds a faint "0".
- A line above says where the code went; the resend link sits under the cells.

## Onboarding

- Progress is a vertical stepper in a side panel a step off the page, or a row of pill dots
  with the current one stretched. One of them, never a "Step 2 of 5" beside it.
- "I'll do this later" is a ghost or outline button stacked under the primary.
- A step that sets up the product shows its live preview beside the choices.

## Choice cards

- For a few options that need a line each (a plan, a workspace type, a role). Each card: the
  name in the label style, at most one muted line, a radio mark at the top right.
- Selected: a `2px` border in the accent and a filled check in that corner; the card's fill
  stays. Unselected: the system's border and an empty circle in the same spot. Nothing else
  changes: no tint, no coloured text.
- One option likely: it leads and is preselected.

## Check

| You see | Fix |
| --- | --- |
| A field drawn as an underline only | The system's field, its label above |
| A selected card tinted, bordered, coloured and checked | The border and the check only |
| Code digits or the active step in the accent | Digits in the foreground; the ring marks the active cell |
| A password checklist and a meter together | One |
