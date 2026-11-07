---
name: ultrapaint
description: "Interface design rules. Use to design, build or review a screen, page or component; to write its words; or to make its design system: create, extract from code or pictures, import from Figma."
---

# Ultrapaint

How to design an interface the people it is for judge well made. Every rule below holds on every
screen it names, whatever else you read. The files under `references/` add what a rule line cannot
hold: the anatomy of a kind of screen, the recipe of a kind of page, tables of values, the reasons.

A *screen* is a product's own interface: a dashboard, a form, settings. A *page* is public: a
landing page, a shop, a portfolio, a magazine. A rule that names one holds for that one.

Three jobs, below: designing a screen or a page with the design system it has; making the design
system; writing only the words.

## Designing a screen or a page

1. **Settle the character.** DESIGN.md's Overview says how the product should feel, and its
   tokens say the rest; a design system without a DESIGN.md says it through its face, radius and
   colours. Take it and ask nothing. When neither exists, open `references/character.md` before
   the first element: it settles the character from the product, the picture or the request, or
   asks the user one question, and writes it down.
2. **Name the screen's job, its primary action and its kind** in one sentence: "Billing settings:
   change the plan; settings." Open the kind's file from the table below now, before the first
   element. When you cannot name the job, ask the user.
3. **Build it with the design system**: its components, text styles and tokens, by the rules
   below. A picture to remake: open `references/picture.md` first.
4. **Draw its states**: the ones its content implies (States, below).
5. **Check.** Run every rule below against every screen, then the checks of each file you
   opened, and fix what fails. Your last message names each file you opened.
6. **Have each section reviewed.** Where your work is reviewed for you (an editor's review loop),
   answer its findings. Elsewhere, when you can start another agent, have a fresh one review each
   section from a crop at 2× (dark and light where the product has both) with this skill, and fix
   what it finds.

### The kind of screen or page

| Designing | Open |
| --- | --- |
| A dialog: a form, a confirmation, sharing, inviting, an upload | `references/kinds/dialog.md` |
| Settings, billing, integrations, a profile, a team page | `references/kinds/settings.md` |
| A table, a list of records, their filters and pagination | `references/kinds/table.md` |
| A dashboard, figures, charts | `references/kinds/dashboard.md` |
| Sign-in, sign-up, onboarding, a contact form | `references/kinds/form.md` |
| A sidebar, a header, a command palette, a menu, a calendar or date picker | `references/kinds/navigation.md` |
| A toast, a notification panel, an AI chat, a file manager | `references/kinds/feedback.md` |
| A product's landing page: hero, features, pricing, FAQ, testimonials, footer | `references/pages/landing.md` |
| A shop, a restaurant, a hotel | `references/pages/shop.md` |
| A portfolio, a studio, an agency | `references/pages/portfolio.md` |
| A magazine, a blog, a long article | `references/pages/editorial.md` |
| A game's site or title screen | `references/pages/title.md` |

A screen of two kinds (a table inside settings) opens both. A kind not listed opens none.

## The rules

### Hierarchy

- One primary action per screen, in the primary variant; the rest secondary, outline or ghost by
  use; past three secondary actions, the rest in a "More" menu. A reading screen may have none.
- The squint test: the content the screen is for and its primary action are the two heaviest
  shapes. When five things compete for first, demote four.
- Rank by position first, then weight or colour, then size, which is the loudest. One tool per
  step; all three on one element shouts.
- The page title says what the screen is in two to four words. Every heading leads its section;
  the text under it adds what the heading does not say.
- In a row, the identifying content leads; metadata and actions trail. The one figure the user
  came for tops its group, larger and heavier than its label. What the user does most sits where
  the hand already is; what frames the whole page sits in its header.
- Rows of equal weight are a menu, not a hierarchy: the likely choice leads, and when none is
  likely there are few choices.
- A destructive action sits apart from the primary, at the far end or in a menu, in the
  destructive variant.
- Nesting stops at three containers: past that, a heading and a gap.

### Restraint

Every element earns its place. A label, description, caption, heading, tooltip, badge or icon that
says what the content already shows is noise: remove it, rather than shrinking or greying it.

- Structure explains: when a design needs words to explain its grouping, fix the grouping.
- No description that restates its heading, no intro, eyebrow or subtitle on a screen whose
  purpose is plain, no heading over a group its content names, no "Click to upload" under an
  upload area, no label repeated on every row that a column header says once.
- No decoration: an icon beside every label, a box around one element, a divider between things
  already apart, a badge that says nothing, an icon inside a field its label names.
- A value appears once, where it is read or set: not a size on its frame and again in a caption,
  not a count on a group and on its heading.
- Context that depends on a selection or a mode appears only in that state, beside the action it
  affects.
- A list holds one kind of item doing one kind of thing; an item that does something else goes
  where that kind of thing lives.
- Content leads, chrome recedes: when navigation, borders or backgrounds draw the eye first, take
  weight out of the chrome.

### Layout

- A page is a few regions (header, navigation, main column, maybe a side panel) laid out first,
  then filled. A public page is a stack of full-bleed bands, each band's content in one container.
- A few shared edges: left edges of text line up, labels and values share a baseline, columns start
  at one x. Each section holds one alignment, left or centred; a centred hero over left sections
  is fine.
- Width has a ceiling: a product's main column takes a container token (about `768px` for prose
  and forms, a form stopping at its longest comfortable field); a public page's container is about
  `1200–1300px`, its prose `560–760px`.
- Sizes follow content: text and its containers hug or fill; fixed sizes only for what has one (an
  avatar, a thumbnail, a sidebar); bound a box with a min and max width.
- A control sits next to what it changes: filters above their list, suggestions against their
  field.
- One page for every width, smallest first, with what changes at each breakpoint; never a second
  design for the phone. Check at the system's breakpoints, or `390` and `1440`: something moves at
  each (a panel becomes a sheet, columns stack, a table becomes a list).
- Text and controls stay `16px` or more inside the edge on a phone; backgrounds, media and
  full-width tables may bleed. The primary action stays reachable.
- One scroll region per page. A horizontal scroller lets the next item peek `16–32px`.
- Density follows the task: compact where the user works (tables, toolbars, editors), open where
  they read or decide (settings, onboarding, empty states).
- More: `references/layout.md`, when a page must reflow across widths or a public page's
  structure is open.

### Spacing

- Every gap and padding is a step of the spacing scale. Pick four steps (inside a control, between
  related elements, between groups, between sections) and reuse them; a `13` or an `18` is a step
  not picked. One relationship is always one distance.
- Proximity groups: the gap between groups is at least 2× the gap within one, measured between
  the text. A label sits nearer its field than the field above it; a heading nearer what it
  introduces than what came before. A title and its one-line description: `2–4px`.
- Group with space alone in a form or on a page. Where a screen or dialog does several jobs (a link
  to copy, people to invite, a plan to choose), each job sits on its own quiet surface (a faint fill
  or a `1px` border, the large radius, padded `16px` in a dialog or tool, `24–32px` on a page),
  and needs no heading.
- A short list of toggles or options is bare rows; only a long list of one kind of row (settings,
  a table) is split by hairlines. A page section is not a card unless it holds a job.
- One edge is drawn once: a gap or a rule, never both; a line or a surface, never both.
- Space between siblings is the parent's gap; margin is for the one child that stands apart.
- Even padding on every side; give an icon's side `2px` less where it looks heavy.
- Filled or outlined controls side by side: `8–12px`; borderless text and icon buttons:
  `16–24px`. A header's icon buttons and avatar share one gap and one centre line; a dense
  toolbar goes tighter while each target keeps its own area.
- On a public page the section step is about `120px` (news fronts and shop grids `40–90px`), and a
  surface is padded about a quarter of it.

### Type

- Every text takes a text style of the system: size, weight and line height as one decision. Its
  face is the product's, loaded; a fallback face reads as a defect. One sans for the interface,
  Inter or Geist when nothing names one; a serif only for a page's display headlines, unless the
  user asked for one.
- Three sizes on a product screen (title, body, small), a fourth only for one display figure; a
  public page up to six, with one hero size (about `44–90px`). Emphasis inside a role is one
  weight step, `400` to `500`, not a size.
- A title is large only on a page about one thing. A top bar's or panel's title is body size, one
  weight up; a dialog's or small form's is about `18–20px` semibold, by the character. A display
  headline ranks by size: regular or medium, bold only when the brand calls for it.
- Control text (navigation, tabs, buttons, menu items) is one style, medium, never bold.
  Navigation is muted; the current item takes the foreground and its row's fill.
- A field label is semibold, `600`, in the foreground, one style wherever a label sits (a field,
  a checkbox or switch row, a group, a table's row label). In "View · Daily", the label is muted,
  the value foreground.
- Names in a list take the label style, heavier than their metadata.
- Headings descend with their level: a lower level is never larger. Line height: headings
  `1.1–1.25`, body `1.5`, anything wrapping to three lines `1.4` or more.
- Tracking: headings `24px` and up `-0.02em`; capitals at label sizes `0.05–0.1em`; uppercase
  display `40px` and up `0` or tighter; body `0`.
- A paragraph runs 60–75 characters: cap its column at about `65ch`.
- Floors: body `16px`, interface text `14px`, captions `13px`, nothing under `12px` except an
  uppercase or mono label on a public page at `11px`. Under `18px` the weight stays `400` or more.
- Two text colours plainly apart: the foreground for what is read first (titles, names, values,
  labels of actions); muted for what qualifies it (descriptions, hints, timestamps, metadata,
  placeholders). In one region, muted plays at most two roles; a group label outranks its
  details by weight or space.
- A name in a dense row truncates to one line, its full value in a tooltip; messages wrap.
  Headings `text-wrap: balance`, descriptions `pretty`.
- Typeset: curly quotes, `…`, an en dash for ranges, `×` for dimensions; sentence case in the
  copy, capitals from the style. Tabular figures only in columns compared down.
- More: `references/typography.md`, when you choose or load a face, or set a public page's type.

### Colour

- Colour is meaning. Surfaces, text and borders take semantic tokens by role, each only for the
  job its name says (never the border token as text). A palette colour or a raw value on a screen
  is a decision the system did not make: use the role's token, and where the role has none, add
  it to the system and say so.
- Neutrals neutral or warm, unless the user asked for a cool feel; when the system's are
  blue-grey for a character that is not cool, tell the user.
- One accent: the primary action and a chosen option (a selected card, a switch on, a checked
  box). Headings, icons and borders stay neutral. On a button the accent is the fill with its
  foreground pair. A product's screens have one accent; a public page may add one hue with one
  fixed job.
- The foreground computes to `15:1` or more on its background; muted to about `4.5–5.5:1`. Compute
  both from the token values in every theme; darker than `6:1`, muted blurs into the foreground:
  tell the user and use it all the same.
- A status badge is the system's neutral Badge (a fill that differs from its card, foreground or
  muted text) with at most a small coloured dot inside. Status colours report status only, never
  decoration or a chart series; categories take their own hues.
- Selected is the system's selected style, a neutral fill or a solid brand fill, never a pale wash
  of the accent. Hover, pressed, focus and disabled are steps of the same role; a state brings no
  new hue.
- Text on a colour takes its pair (primary-foreground on primary); text on a photograph or a
  gradient sits on a scrim. A gradient is light on a public page, never a surface for
  navigation, cards or controls.
- A chart takes the chart colours in order; its series are named on the chart, not in a legend
  the styling makes needless.
- More: `references/color.md`, when you add a token, compute contrast, colour a chart or colour a
  public page.

### Surfaces, borders and radius

- Most things are flat. Four levels, each a surface with its shadow: sunken, default, raised,
  overlay; a shadow belongs to a level, never a custom one. A list of cards is flat with borders.
- A surface inside another sits one tone step apart, in both themes. A card's chrome sits a step
  down from its content panel.
- A popover is attached to its trigger, `4px` off its edge.
- A border marks an edge that must be seen, in the border token for its role.
- One radius family by size; buttons and fields share the default radius. A corner inside another
  takes the outer radius less the padding. Full-bleed images and bare tables are square.
- More: `references/surfaces.md`, when you layer surfaces, overlays or shadows.

### Icons

- One set, the system's, at its listed sizes, matched to the text beside it; stroke `1.5` beside
  regular text, `2` beside medium or semibold. An icon takes its label's colour.
- Outline by default, filled when active. One icon per meaning across the window, and the icon
  and its name agree.
- An icon earns its place where it speeds recognition: not on headings, eyebrows, names, plain
  links or every bullet; all or none in one menu; at most one in a page header's buttons; no
  folder before every item of a tree.
- An icon-only button has a tooltip and an accessible name. A brand mark keeps its official form.
  No emoji for icons.
- More: `references/iconography.md`, when you choose a set or draw icons for a public page.

### Components

- Compose with the system's components before drawing anything: a button, a field, a badge, a
  dialog, tabs. A copy drawn from boxes and text matches nothing in the code.
- Variants carry meaning (destructive, secondary, size); restyle only through props and
  variants. Text inside a component is its own text, real, never "Button".
- A form is labelled fields in one column, the primary action at its end; two fields share a row
  only when they are one thing (a city and its postcode).
- Controls inside a row or a sentence stay quiet: text and a chevron, not an outlined select. A
  switch sits at the row's right edge, its label left.
- A copy action sits inside the field's end; a field's hint is its placeholder; a change badge sits
  at the row's far right with no caption.
- More: `references/components.md`, before you use a component you have not used in this
  system.

### States

- Draw the states the content implies: text it does not author (empty, one word, typical, long,
  one unbreakable string); a list (none, one, the real count, ten times it); the network (loading
  and the error); input (field errors, submitting); a change (success, the confirmation or undo).
- An empty state says it is empty and offers the action that fills it; three or four suggestions
  at most.
- Loading keeps the layout: skeletons, not a page spinner; every loading state can end in an error
  with a retry.
- An error sits under the field it belongs to. A submit stays enabled and says what is missing.
- A field that saves on its own shows saving and saved beside it.
- What can be undone acts and offers the undo; a confirmation names what is lost.
- More: `references/states.md`, when you draw any state beyond the loaded one.

### Usability

- Every dialog, step and mode has a way out: Cancel, Back, Escape.
- One action has one name, one variant and one place across screens; it keeps its place and form
  once used, empty or not.
- Constraints before errors: a picker where the valid set is known; a format that can be read is
  accepted.
- What a decision needs is in view beside it.
- A row's main action is in view at rest; the rest in its menu, not only under the pointer. Rows
  that look alike do the same thing on click.
- A daily tool's frequent actions have shortcuts, shown in their menu items.
- More: `references/usability.md`, when the screen is a flow of steps or a tool used daily.

### Accessibility

- Contrast meets AA: text `4.5:1`; large text (`24px`, or `18.7px` bold), icons, field borders
  and focus rings `3:1`. Compute muted text on tinted surfaces.
- Colour is never the only signal: a word or an icon beside it.
- Focus is visible. Targets are `24×24px` at least (`44×44px` on touch), reached by padding (a
  checkbox, a chevron), never overlapping.
- Every field has a visible label; heading levels run in order; an informative image has alt text.
- A box of text has no fixed height.
- More: `references/accessibility.md`, when you build focus, keyboard or screen reader behaviour.

### Words

- Real words at real lengths, in the product's voice and its names for things: a long name beside
  a short one, a figure ("750,000+ clients") over an adjective. No lorem ipsum, "Title", "Item 1".
- Nouns label, verbs act: "Send invoice", not "Submit" or "OK". Sentence case.
- An error says what happened and how to fix it; a confirmation names the consequence; a link
  names where it goes; a setting describes its on state.
- One form for the labels of one list, one format for one kind of fact.
- More: `references/words/interface.md` for a screen's words, `references/words/pages.md` for a
  page's, `references/words/voice.md` to settle how the product sounds.

### Motion

- Motion has a purpose and moves transform and opacity, and on a public page a clip-path for a
  reveal; never width, height or position. What the user sees hundreds of times
  a day does not move; hover and tabs at most a `150ms` fade; menus `150–250ms`; dialogs and
  sheets `200–300ms`; colour hover on a public page `150–200ms`.
- Enter with `cubic-bezier(0.23, 1, 0.32, 1)`, from `scale(0.95)` and opacity `0`, never
  `scale(0)`; a popover grows from its trigger. Under reduced motion, loops stop.
- More: `references/motion.md`, before you specify any transition.

## Making the design system

Creating one, reading one off a product's code or pictures, importing one from Figma, making or
changing its components. A screen that needs something the system lacks says so, and the system
is changed by this job, not by the screen.

1. **Settle the character** (`references/character.md`).
2. **Read what exists before deciding anything**: a product, its code or pictures,
   `references/system/extract.md`; a Figma file, `references/system/figma.md`. What the product
   already decides is taken as it is, even where a rule here would choose otherwise; say where it
   breaks one.
3. **Set the foundations** (`references/system/foundations.md`): the face, colour by role, the
   type scale and text styles, spacing, radius, elevation, motion, icons, widths. Every role a
   screen needs has a token, named by its role.
4. **Make the components** (`references/system/components.md`).
5. **Write down what is not a value** in DESIGN.md: the character in its Overview, the words the
   product chose in its Content section (`references/words/voice.md`), what each colour is for and
   never for, the reason for each choice the user did not make. DESIGN.md holds this product's
   choices; a rule that holds for any product stays here.
6. **Check** the rules of each file you opened, and name them in your last message.

A new project with no design system (a theme that declares nothing, no screens) gets one before
its first screen: the character, then the foundations in it, a loaded face and real scales,
written in DESIGN.md. An app with screens and no design system keeps its look: draw with the
values its code already uses, say once that it has no design system yet, and make one when the
user asks.

## Writing only the words

Writing or reviewing a screen's strings or a page's copy and nothing else:

1. **Settle the voice** (`references/words/voice.md`): DESIGN.md's Content section and the words
   the product already uses come first.
2. **Open the place's file**: `references/words/interface.md` for a screen,
   `references/words/pages.md` for a page.
3. **Write real words at real lengths**, by the rules above.
4. **Check** the Words rules and the checks of each file you opened.
