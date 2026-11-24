---
id: p17
title: A redesign drawn as the screen it replaces
kind: process
status: open
found: 2026-11-24
source: the person's redesigns of existing screens in the design chat; p06 and p12 in the editor's 3 Nov redesign
skill: [SKILL.md, references/picture.md]
sections: []
---

**What happened.** The person asks an agent for a new design of a screen that already exists, and
the result keeps the screen's layout, regions and components with a restyle. They then ask again
for "a whole new layout". p06 (copy kept because it was there) and p12 (elements drawn before
they are ranked) are the same pull, seen in the editor's own redesign of 3 Nov. That redesign
restyled each panel as it stood.

**The skill now.** It has no redesign step:

- The design job's step 2 names the screen's job, its primary action and its kind. Step 3 is
  "Build it with the design system".
- A picture is remade by `references/picture.md`: "Nothing missing, nothing added", "Each control
  sits where the picture puts it". A screenshot of the current screen, read as the picture to
  remake, brings that rule with it.
- "One action has one name, one variant and one place across screens" holds rightly for the
  screens beside it, and pulls the same way on the screen itself.

**Evidence.** An example in view is copied, and telling the copier not to does not stop it;
directions planned before drawing make results differ
(`~/Code/ultrapaint-data/research/2026-11-24-fresh-redesign-anchoring.md`).

**The editor's side first.** ADR 0139 gives variations a distance (This design, Different, Fresh)
and a content brief. A Fresh round runs in a new chat, and `read_page` and `get_screenshot`
refuse the original to it for as long as that chat lives. Its shell can still open the
page's file, which the task forbids. That changes what the agent is handed, which an
instruction cannot do.

**Proposed** (measured before the skill changes). A redesign step in the design job, in
capability terms (ADR 0110), for a screen that already exists when the brief asks for a new design
of it:

1. Write the screen as words first: its content, objects, actions and states, its job and its
   users.
2. Name one direction per take, each a different layout model or main thing, and today's
   layout as one to avoid.
3. Where the current screen is in reach, look at it only once the drafts exist, to check that
   nothing was lost.

`picture.md` is opened for a picture to remake, never for the screen being redesigned.

**Test.** A redesign track in the lab, on hosts that have screens, at Opus. Rounds at each
distance, with the shipped skill against the candidate step:

- **Distance:** how far each take is from the original, and from the other takes. Judged by a
  panel on the screenshots, on layout model and main thing, not on colour.
- **Content kept:** the share of the content brief's items present in each take.
- **Quality:** the usual panel score, so that distance is not bought with worse screens.

The step ships only if it adds distance at Fresh or Different without losing content or quality.

**Result.**
