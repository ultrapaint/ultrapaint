---
id: g16
title: One fact shown twice on one screen
kind: missed
status: open
found: 2026-11-03
source: the new chat's starters, editor redesign (branch redesign)
skill: [references/restraint.md]
sections: [chat-starters]
---

**Setup.** The Agents panel's empty thread. The prompts predate the redesign; the redesign pass restyled them (no accordion, icon tiles or descriptions, so all ten choices on screen at once) and lengthened the intro. Neither it nor the lead's review questioned the words or the choices. The person asked for a judgement; the lead scored it 5/10. This finding came from a rule the skill has.

**What happened.** The model, "Opus 5.5", appeared in the thread's header and again in the
composer's model select.

**The skill now.** `restraint.md`: "A heading, caption or description that repeats what is
beside it". The word "beside" limits the rule to neighbours, and these two are a panel apart.

**Proposed.** In `restraint.md`: "…that repeats what the screen already shows, beside it or
not. The control that sets a value is where it is read."

**Test.** Screens with a value set in one place and shown in another: whether the duplicate is
removed.

**Result.**
