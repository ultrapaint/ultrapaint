---
id: g90
title: A long form's primary away from its end
kind: missed
status: open
found: 2026-11-21
source: the person, on fx-opus-new20 (decisions/new20)
skill: [references/kinds/form.md]
sections: []
---

**What happened.** On the clinic's new-patient form, run 1 put Register and Save draft in a bar
fixed to the window's foot, and run 2 put them at the top of a side list. The person: "Why one on
a footer (for no reason since that you need to complete all data I guess and therefore there is no
need to have the button on the first viewport, and the other in the sidebar, and none at the
bottom?"

**The skill now.** `references/kinds/form.md`, Actions: "The primary is full width, as wide as the
fields, at the form's end", and "On a long form on a phone, the primary stays reachable, fixed to
the bottom". The file opens on sign-in, sign-up and contact forms, so a long form in an app read
it as not its own, and the phone's fixed bar was taken to a desktop.

**Proposed.** In `form.md`, Actions: "On every form, short or long, in a page or an app, the
primary sits at the form's end, after the last field; fixed to the bottom only on a phone. A
draft saved on its own needs no Save draft button, only its line ('Draft saved 40 seconds ago')."

**Test.** `fresh-patient-intake` and `fresh-workspace-settings`, 2 runs each, Opus designing with
the candidate: where the primary is. It passes when it sits after the last field in every run.

**Result.**
