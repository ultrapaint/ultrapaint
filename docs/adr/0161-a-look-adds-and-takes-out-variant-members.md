# ADR 0161: A system component's look adds and takes out variant members

Status: accepted, 2026-11-27. Amends 0041 (the structure rule), 0045 (the Library's boards) and
0106 (what Problems lists).
Builds on UP-227's validated look changes (`handoff`'s `change`, the file check) and 0155 (`/init`
sets the looks). Story: UP-228.

## Context

A system component's variant axes and members were fixed in its catalogue entry (Badge's
`variant`: default, secondary, outline, destructive). A look could restyle a member but never add
or remove one. 0041 gave a product's extra member one home: an app component built on the system
component, with a `choice` property. That app component's code is a wrapper the product does not
have, and no agent in the usage logs used it.

In the logs of 2026-11-10 to 25, an agent on a client project wrote a Badge look adding `warning`
to `variant` and a `pill` shape. The file check refused it, and the agent overrode 7 badges by
hand. Those overrides map to nothing in the product's `<Badge variant="warning">`. The Library
also offered members the product does not have, and agents then placed them.

## Decision

**A look has the product's own variant members.** A system component's file gains `members`,
per axis `{ add, remove }`:

- `add` lists the product's members, offered after the catalogue's.
- `remove` lists the catalogue's members it takes out.
- An axis the component lacks is the product's own (`shape: { add: ["default", "pill"] }`). Its
  members are all added, and the first is its default, as the catalogue's first is.

A member is a place of the look like a built-in one: styled in `variants` and `variantStates`.
Changing a built-in member's look is what a look always did.

**One function makes the component as the look has it.** `systemMetaIn`
(`packages/system-components/src/catalogue.ts`) merges `axesOf`'s members into the entry. Each
axis offers the catalogue's members but the removed, then the added. The axis's prop chooses among
them, starting in the first. An axis of the product's own becomes a prop after the catalogue's. A
new instance starts in a member that is offered.

That function feeds the catalogue (`catalogueOf`), the drawn look's defaults (`lookOf`) and the
file check. Through the catalogue it also feeds the inspector's Variant field, the Library's
boards, `get_component` and `list_components`, and the code writer.

**The structure rule, amended.** A project may add or take out appearance-only members of a
system component. A member that adds behaviour, props, slots or text is still an app component
built on it.

The file check refuses what cannot mean anything, naming the place (`members.variant: …`):

- a member added twice, or one the axis has already;
- a member removed that the axis does not have built in;
- an axis left with no member;
- an axis of its own named like one of the component's props, or one with nothing added;
- a member name other than letters, digits, `-` and `_`.

An added member's styles may set style fields only. A file whose added member sets another field
(`text`, `props`) is refused with that reason, read off its JSON: reading the file as a component
would silently drop the field. Files that add nothing are checked as before, so a stray field in
an existing look still reads. Through the tools, a `setStyle` whose style sets another field is
refused in the same words, whatever its place (`notAStyle`), since decoding the change would drop
the field as well.

**An instance that sets no member of an axis is in the one the look starts it in.** Where the
look moves an axis's first member off the editor's (it takes out Badge's `default`), the canvas
marks such an instance with the look's (`lookPropsOf` in the renderer), so the default look's old
first member no longer draws under the product's. Copy as code's HTML takes the last look's first
member in every look (`restingDeclarations`). Every other instance is marked as before.

**A removed member is hidden from choice, never from the page.** Its instances keep their value
and keep drawing. The look keeps what it styles in it, the default look's layer still draws it,
and the Library's board no longer draws it. Problems lists the instances of each removed member
(`removedMembersOf`, on the pages the editor has read and in the app components' trees). Its fix,
"Move to…", sets the axis on every one of them to a member the look offers, in one undo step.

Taking out one of the product's own members also takes out what the look styles in it.

**The tools.** `handoff`'s change takes `{op:"addMember", axis, member}`: it puts back a
built-in member taken out, or adds after the axis's members, an axis the component lacks becoming
its own. `{op:"removeMember", axis, member}` takes a member out. Each change is one undo step,
named for the member.

A `setStyle` at a member or axis the look lacks is refused with the `addMember` that would add it.
`apply_operations` warns of an instance the call placed or changed in a member its look does not
offer, a removed one or one never added (`variant: "warning"`), with the `addMember` that adds
it. `get_component` answers `members`, an axis a line (`variant: adds neutral-strong; takes out
outline, …`, `shape: the product's own axis, default|pill`). Its `variants` and `props` are the
merged ones, and so is `list_components`' line.

The change parameter is an untyped object, so the tools' budget is unchanged.

**The editor.** The look inspector's Variants section lists each axis's members in one field, as
an app component's choice does. Members typed there are added, the added ones first; members
deleted from it are taken out. A row adds an axis of the product's own (`shape: default, pill`).

**The code.** Copy as code and the Code tab write the product's members as the component's own
props (`<Badge shape="pill" variant="neutral-strong">`), as they write any prop.

`/implement`'s task for a system component names its members, and has the agent give the
component's variant props the members its file adds. A member it takes out stays in the code
while something uses it.

**Reading the product's members.** Nothing in the repository reads a `cva` variant map, and Sync's
export reads tokens, not components, so it gains nothing here. `/init`'s looks step (0155), which
Define reuses, has the agent read the product component's variants itself. Where the
product declares a member or axis the system component lacks, or lacks one the system component
offers, the agent asks the person, one question per component (0140). It then adds or takes out
the member through the tools, or in the file without them, before it sets the look.

## Consequences

- A product's own `<Badge variant="warning">` is one component on the canvas, in the Library and
  in the code. No wrapper app component is needed, and no instance is overridden by hand.
- A project that adds and takes out nothing is unchanged: the catalogue's entry, the drawn look
  and the checks are the editor's own.
- A member can be added to any axis of a system component, a Separator's `orientation` too, whose
  view knows only its own: such a member draws as the view's fallback, styled as its look says.
- A removed member's instances are found only on the pages the editor has read. One on a canvas
  not open shows once that canvas is.
- The built-in Badge set growing (warning, success, info) is UP-252's, beside this.
