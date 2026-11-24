# ADR 0128: Space is the pan's while it pans

Status: accepted, 2026-11-24.

## Context

A person pressing Space a few times found the canvas stuck on the hand: the cursor stayed the
open hand, and the toolbar's tools seemed not to bring the pointer back. The focus was on the
toolbar's Pan button, left there after the Pan tool was clicked and V pressed to go back to
Select. Base UI's toggle-group item clicks itself on Space keydown, before the window's Space
handler: each press of Space picked the Pan tool for good, as if H had been pressed. Any focused
toggle did the same to its own tool (Comment also opened the comments), and a toggle group in a
panel would change what it sets.

The reference product says only that holding Space turns the hand tool on for as long as it is
held, that H turns the hand tool on, and that a pan stuck on the hand is ended by switching
windows or tapping Space. Its users report that Space typed in a focused field types a space, and
that its hand sticks when the canvas loses the keyboard focus while Space is held. Nothing it
publishes covers the cursors, a release mid-drag, or Space on a focused button.

## Decision

**Space held over a canvas pans whatever the tool, and while it pans the key is the pan's
alone.** `useSpacePan` takes Space on the window before what has the focus: the press, its
repeats and the release are prevented and go no further, so no focused button, toggle or tool
acts on it.

**Space is not the pan's** when it is typed into a field (`isTyping`, a frame's page included) or
a dialog, a menu or the settings are open, as the window's other keys are not (`windowScopes`).
A held key's repeats stay the pan's that its first press began.

**The pan ends** when Space is released, wherever the focus went meanwhile, and when the window
loses the focus or the page is hidden, where that release never arrives.

**What the pan shows** is unchanged: the open hand while Space is held, the closed hand while
dragging; the tool is back the moment Space is released, and a drag that began as a pan stays one
until the button is let go.

**H is the Pan tool**, kept until another tool is picked; Space is the hand for as long as it is
held. The tools' strip shows Pan while Space is held.

## Consequences

Space never presses a focused control while a canvas is on screen, unless a menu or a dialog is
open; a person who reaches a toolbar button by Tab presses it with Enter. A Space held while a menu
opens stays the pan's until it is released.

Two ways differ from what the reference product's users report: Space pans with the Comment tool
too (theirs draws a comment), and a pan ends when the window loses the focus instead of sticking.
