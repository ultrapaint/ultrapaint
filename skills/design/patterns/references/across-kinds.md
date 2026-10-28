# Across kinds of screen

## Grouping

- **Overall:** space 34%, dividers 29%, mixed 25%, cards 12%. Typical nesting depth is 2.
- **The split follows the kind:**
  - Space only: forms (82%) and marketing (58%).
  - Dividers: settings (53%), menus (50%), tables (50%), dialogs (42%).
  - Cards: dashboards (22%) and dialogs (21%).
- **The dividers have their own idiom:**
  - full-width hairlines between header, body and footer;
  - **dotted** rules between sections (~35 notes across kinds);
  - a section title sitting on a full-width rule in place of a card (dashboards, ~6).
- **Cards are used for:**
  - selectable options;
  - KPI tiles;
  - integration and plan cards;
  - insets that hold a payload: an attachment, a quoted comment, a read-only link.
- **Card-in-card** (a tinted header strip over an inner white panel) is a recurring dashboard and billing look (~10 notes).

## Descriptive text

**How often each kind has a header description**

| Kind | Header has a description |
| --- | --- |
| Dialogs | 74% |
| Marketing | 70% |
| Settings | 61% |
| Picker | 56% |
| Other | 53% |
| Profile | 50% |
| Form | 35% |
| Table | 19% |
| Dashboard | 15% |
| Menu | 13% |
| Navigation | 10% |
| All kinds | 43% |

- **Length.** Titles run about 2–3 words; descriptions about 8 words, one line, in muted grey regular.
- **Choices.** 18% of pieces give their choices a description. Most are mega-menu items (two lines each), toggle and checkbox rows in settings, and option cards.
- **Field text.** Helper text is rare: 5% overall, and 36% only on profile editors. Fields are labelled in 45% and placeholder-only in 49%; most placeholder-only fields are search fields.

## Spacing

| Kind | Within a group | Between groups | Container padding | Between ÷ within |
| --- | --- | --- | --- | --- |
| All | 14 | 32 | 24 | 2.3 |
| Dialog | 14 | 24 | 32 | 1.7 |
| Settings | 16 | 40 | 24 | 2.5 |
| Menu | 12 | 24 | 24 | 2.0 |
| Dashboard | 16 | 40 | 24 | 2.5 |
| Marketing | 16 | 64 | 32 | 4.0 |
| Form | 12 | 32 | 36 | 2.7 |
| Navigation | 8 | 32 | 20 | 4.0 |
| Table | 12 | 32 | 24 | 2.7 |
| Profile | 12 | 40 | 24 | 3.3 |
| Picker | 8 | 32 | 24 | 4.0 |

- **The rule:** groups are 2–4× further apart than their members. Dialogs are the exception at 1.7×, because their groups are also held by dividers.
- **Padding:** 24 by default, 32 in dialogs and marketing, 20 in sidebars.
- **Gaps between cards are tighter than the padding inside them.** One bento dialog measures ~12 between cards against ~28 inside.

## Actions

- **Placement overall:** inline 33%, header 24%, footer-full-width 17%, none 15%, footer-right 11%.
- **The pattern differs by kind:**
  - Forms finish full-width (84%).
  - Dialogs finish bottom-right (58%).
  - Tables (65%), dashboards (55%) and profiles (58%) put actions in the header.
  - Settings act inline (44%).
- **Primaries:** one per piece, two on marketing pages (nav plus hero). Dashboards often have none (~6 notes).
- **The order is always secondary, then primary**, primary at the right or on top when stacked.
- **A third, quiet action goes to the far left** of a dialog footer (~26 notes).
- **Destructive actions** come last in menus, after a divider.
- **Dismissive actions are demoted to text.** Toasts and the AI chat use text-only action pairs that differ only by tone (~12 notes). A company-details dialog even uses a text-only Cancel.

## Type scale

- Typically 4 sizes and 2 weights.
- 5 sizes and 3 weights in dashboards, marketing and profiles, where a display figure or headline is added.
- 3 sizes in menus and navigation.
- Emphasis comes from weight and from colour (dark against muted grey) far more than from size.
- The very large figure is the exception: 40–100 px balances and KPI numbers.
- Serif or italic display words recur on marketing and auth pages (~20 notes).

## Icons

| Where icons appear | Share of pieces |
| --- | --- |
| Buttons | 59% |
| List rows | 53% |
| Navigation | 50% |
| Leading in fields | 35% |
| Decorative | 34% |
| Headers | 23% |
| Labels | 11% |

**Where they go:**
- top-level navigation rows;
- menu action rows;
- mega-menu items (in tiles);
- dialog headers (a featured icon);
- search fields (magnifier);
- status (a dot or icon with a word);
- icon-only row actions (kebab, trash, pencil);
- metadata rows (pin, calendar);
- toasts.

**Where they do not:**
- child items of a tree (~14 notes);
- people lists, which get avatars;
- plain link menus, which get trailing chevrons;
- most toggle rows;
- footer link columns;
- table cells other than the identity cell.

**How they are drawn:** one outline style, rounded 2 px stroke, about 20 px in nav rows. The active state is shown by the row's fill rather than by switching to a filled icon.

## What the accent marks

- The primary button.
- The selected option card: a 2 px border, a tinted fill and a filled check (~25 notes).
- A toggle that is on, a focus ring, an active tab underline in some pieces.
- Range endpoints, the selected count ("3 selected").
- Required asterisks, links, and marketing eyebrows.

**What it usually does not mark:**
- The active navigation item, which is neutral grey in ~25 of ~38 sidebar notes.
- Charts, which are mostly monochrome with a green delta.

**A neutral accent.** ~15 notes describe fully monochrome or single-hue pieces where the "accent" is near-black.

**Status colours** stay on status: green deltas, dots, Paid and Active badges.

---
