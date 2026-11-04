# Usability

Jakob Nielsen's ten heuristics, the expert review of an interface: people can tell where they are
and what happened, read their own words, leave or undo what they started, recognise rather than
remember, and go faster the tenth time. Run them over every screen of a flow and the states
between. Five belong to other parts; the five below are held here.

## The five held elsewhere

- Visibility of system status: loading, saving and success in `references/states.md`.
- Match between the system and the real world: the user's words in `references/content.md`.
- Aesthetic and minimalist design: `references/restraint.md` and `references/hierarchy.md`.
- Error recovery: the message's words in `references/content.md`, its place in
  `references/states.md`.
- A visible label on every field: `references/accessibility.md`.

## Every way in has a way out

User control and freedom. A dialog closes with Escape, its close button and Cancel; a step has
Back; a mode (editing, selecting, full screen) shows how to leave it. Filters and a selection
clear in one action. Cancel leaves no trace; a change already made confirms or undoes as
`references/states.md` says.

## One thing, one name, one place

Consistency and standards. An action keeps its label, icon, variant and position on every screen:
Save stays Save on the next form, the primary sits on the same side of every footer. The
platform's conventions hold over invention: the logo goes home, a link looks like a link, a
checkbox is a checkbox.

## Constraints before error messages

Error prevention. Where the valid set is known, offer it: a date picker, a select, a stepper for a
count. Fill the default most people want. Accept a format as typed (a phone number, a card with
spaces) and normalise it, rather than reject it.

## Options in view

Recognition rather than recall. What a decision needs sits beside it: the plan's price by the
button that buys it, the item's name in its confirmation. Recent and suggested items lead a search
or a picker. Every action has a visible control; a shortcut is the second way to it.

## Faster the tenth time

Flexibility and efficiency of use. A tool used daily gives its frequent actions keyboard
shortcuts, shown in their menu items (`references/patterns/menus.md`) and tooltips; a list takes
bulk actions on a selection; a tool with many commands has a command palette. A first visit sees
none of it on the way.

## Help at the point of doubt

Help and documentation. A field or setting that needs explaining gets one line of helper text or a
"Learn more" link beside it, where the question comes; the rest of the screen stays bare
(`references/restraint.md`). A help centre leads with search.

## Before you finish

| You see | Fix |
| --- | --- |
| A dialog, step or mode left only by finishing it | Cancel, Back, Escape, a visible exit |
| The same action named, styled or placed two ways across screens | One label, one variant, one place |
| Free text where the valid set is known | A picker, a select, a stepper |
| A format rejected that could be read | Accept it, normalise it |
| A decision whose facts are on another screen | Bring them beside it |
| An action reachable only by a shortcut | A visible control, the shortcut shown beside it |
| A daily tool's frequent action with no shortcut | Give it one, shown in its menu item |
| A help icon on every label | Helper text where a rule needs it; nothing elsewhere |
| A heuristic held elsewhere left unchecked | Run that part's table |
| Rows that look alike and do different things on click | One click, one meaning; what differs gets its own control |
| A row's actions shown only under the pointer | The one it is for in view at rest; the rest in its menu |
| An action that moves or changes form once used (a button when empty, a + once not) | One place and one form, empty or not |
