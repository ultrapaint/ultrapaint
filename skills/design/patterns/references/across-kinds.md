# Across kinds of screen

## Grouping

- **Overall:** mixed 44%, space alone 24%, dividers 19%, cards 12%.
- **The split follows the kind:**
  - Space alone: forms (66%) and marketing (39%). Settings never use space alone (0%).
  - Dividers: menus (42%), settings (29%), navigation (23%), dialogs (19%).
  - Mixed: navigation (57%), dashboards (55%), settings (51%), dialogs (46%).
  - Cards: dialogs (22%), dashboards (21%), settings (20%).
- **The dividers have their own idiom:**
  - in dialogs, a full-width rule above the footer (~35 notes) and sometimes below the header (~10). Inside the body, space separates the field groups;
  - **dotted** rules as a second, lighter divider (~40 across settings, profiles and dialogs);
  - a word set in a rule ("or", "Today") (~15);
  - in dashboards, a section title over a rule in place of a card (~12).
- **Hover and selection** use a rounded fill inset from the container's edge, never edge to edge (~40 across menus, navigation and tables). A scrolling list fades out at the bottom instead of being cut off (~15).
- **Cards are used for things the user picks or repeats:** option cards, plans, integrations, download rows (~20 in dialogs), plus KPI tiles and dashboard widgets (~20). **Panels that inform are grey fills:** a link box, a preview well, a help accordion, a permission tray (~12).
- **Card-in-card** (a grey frame holding the title over an inset white panel) recurs in ~12 notes. It is common, but it draws one edge twice, and the skills leave it out.

## Descriptive text

**How often each kind has a header description**

| Kind | Header has a description |
| --- | --- |
| Dialogs | 79% |
| Settings | 69% |
| Marketing | 63% |
| Profile | 59% |
| Other | 54% |
| Form | 46% |
| Navigation | 20% |
| Table | 18% |
| Menu | 17% |
| Dashboard | 13% |
| All kinds | 46% |

- **Length.** Titles run 2–3 words. Descriptions run 6–10 words on one muted line.
- **A default, not earned.** A description under every title is common. The notes don't say whether these lines repeat their headings. Nearly every sign-in form adds a subtitle under "Log in". A line has to add something to stay.
- **Choices.** 22% of pieces give their choices a description line: menus 42%, dialogs 34%, settings 32%, pickers 100%. Mega-menu items get two lines each.
- **Field text.** Helper text is rare: 5% overall, 9% on forms, 20% on profiles. Where it does appear, it usually carries live data or rules (an available balance, a password checklist), not instructions. Fields are labelled in 55–67% of dialogs, settings and forms, and in 93% of profiles. Placeholder-only fields dominate menus (76%), dashboards (86%) and tables (65%), and most of them are search fields.
- **Common noise.** Dropzones say "Click to upload or drag and drop" (~8), and placeholders say "Enter your email" (~3). Principle 1 names both.

## Spacing

| Kind | Within a group | Between groups | Container padding | Between ÷ within |
| --- | --- | --- | --- | --- |
| All | 12 | 32 | 24 | 2.7 |
| Navigation | 4 | 24 | 16 | 6.0 |
| Picker | 6 | 24 | 24 | 4.0 |
| Menu | 8 | 24 | 16 | 3.0 |
| Table | 8 | 24 | 24 | 3.0 |
| Marketing | 16 | 48 | 32 | 3.0 |
| Settings | 12 | 32 | 24 | 2.7 |
| Dashboard | 12 | 32 | 24 | 2.7 |
| Dialog | 12 | 24 | 24 | 2.0 |
| Form | 16 | 32 | 32 | 2.0 |

- **The rule:** groups sit at least 2× further apart than their members. Tight lists (navigation, pickers) go to 4–6×. Dialogs and forms stay at 2×.
- **Padding:** 24 by default, 32 in marketing and forms, 16 in menus and navigation.
- **Gaps between cards are tighter than the padding inside them.** Bento share dialogs set their inner cards about 8 apart (~6).

## Actions

- **Placement overall:** inline 34%, header 22%, none 17%, full-width footer 15%, right-aligned footer 11%.
- **The pattern differs by kind:**
  - Forms finish full-width (80%).
  - Dialogs split the footer (64%): a utility or escape action on the left (Help, Copy link, Cancel alone) and the action that finishes the job on the right (~46).
  - Tables (62%), dashboards (61%), pickers (64%) and profiles (43%) put actions in the header.
  - Marketing acts inline (58%).
- **Primaries:** one per piece (median). Marketing has two because the nav repeats the hero CTA. A screen whose job is reading often has none (~10 dashboards and tables).
- **Emphasis rises toward the right:** outline, then tinted, then solid (~5). When the buttons stack on mobile, the primary comes first (3). Confirm and sign-in modals use two equal-width buttons (~9).
- **A field's action sits on the field's row:** Invite, Subscribe, Copy (~20). Copy sits inside the right end of the link field (~9 of 11).
- **Destructive actions** come last in menus, below a divider, in red text (~5).
- **Dismissive actions are text.** Toasts set a muted "Dismiss" before a brighter positive action, aligned to the text column (~14 of ~16).

## Type scale

- Median 4 sizes and 2 weights. Dashboards and marketing use 5 sizes and 3 weights; menus use 3 and 2.

| Element | Size |
| --- | --- |
| Uppercase labels, table headers | 12 px |
| Rows, descriptions | 14 px |
| Navigation labels, mega-menu titles | 16 px, medium |
| Dialog and sign-in titles | ≈24 px, semibold |
| KPI figures | ≈36 px |
| Hero balance figures | ≈48 px |
| Display headlines | 48–72 px, tight tracking |

- Where the typography skill sets a title size or a label weight, the skill holds over these measures.
- Within one size, emphasis comes from weight and colour: a bold actor and a regular verb, a dark value and a muted unit ("$40 per month", ~13).
- Serif or italic-serif headlines are common on marketing pages (~15, one accent per headline). The ~4 product screens with serif headings break principle 9.

## Icons

| Where icons appear | Share of pieces |
| --- | --- |
| Buttons | 72% |
| Navigation | 56% |
| List rows | 53% |
| Decorative | 36% |
| Leading in fields | 36% |
| Headers | 25% |
| Labels | 15% |

**Where they go:**
- every navigation row (89% of navigation pieces);
- every menu row and mega-menu item (89% of menus);
- the leading magnifier of a search field;
- file-type tiles in file rows;
- status (a dot inside an outlined pill);
- row-end actions (a kebab ~8, bare edit/delete ~5);
- toasts.

**Where they do not:**
- table headers (0%);
- child rows of navigation (~16 notes);
- people lists, which get avatars;
- footer links;
- most section titles.

**How they are drawn:** one style, a 2 px outline at 20 px. In a navigation row of about 40 px, the gap to the label is 12. Brand logos keep their colour among monochrome icons. In a menu, icons are all or none within each group.

**Common, and noise by principle 1:**
- a featured icon tile heading ~30 dialogs (51%) and ~5 settings sections;
- a tile before every contact, FAQ or mega-menu item (~20);
- a mail icon in an email field (~6);
- a help icon after every comparison label (~5);
- an icon on every header button (~6) or on "Filters" (~6).

## What the accent marks

- **Selection.** A chosen card gets a 2 px accent border and a filled check (~30). Its fill stays unchanged in ~10 and is tinted in ~4. An unselected card keeps an empty circle in the same spot (~18).
- **Progress and input.** Filled code digits, the active step, an active underline tab (~8).
- **The primary action, only sometimes.** In ~30 notes the primary is near-black and the accent is kept for selection. Where the system's primary is the accent, it marks the primary.
- **Category hues** are separate from the accent: event colours (tint, border and text in one hue, ~8), plan tints, tag pills.

**What it usually does not mark:**
- The current navigation item, which is a neutral rounded fill with the label unchanged in ~22 of ~30. A pale accent tint (~5) or a solid dark fill (~4) is less common.
- Hover.
- Charts, which use greys, dashes and hatching, and no legend in ~25 charts.

**Status colours** stay on status: a coloured dot in an outlined pill (~25), green trend badges, an unread dot (~6).

**One thing marked several ways** is common: a popular plan that is inverted, badged and given a coloured button (~4), or a selected card that is tinted, bordered, coloured and checked (~4). One means is enough.

---
