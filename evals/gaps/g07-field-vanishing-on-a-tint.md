---
id: g07
title: A filled field vanishing on a tinted frame
kind: missing
status: open
found: 2026-11-03
source: editor redesign (branch redesign)
skill: [references/components.md]
sections: [left-card-raised]
---

**What happened.** The canvas picker sat on the rail-toned frame with the fields' usual fill
(`muted`). The fill was so close to the frame that the picker didn't separate from the frame or
from the panel below.

**The fix used.** A translucent fill (`foreground/5`), a hairline ring, and 8px beneath it.

**The skill now.** `components.md` and `DESIGN.md` describe fields as "filled, borderless at
rest". Nothing covers a field on a surface other than the one the fill was chosen for.

**Proposed.** A field's fill contrasts with the surface it sits on. On any other surface, use a
translucent fill and a hairline.

**Test.** Fields placed on each surface of a system, checked for measured contrast against
their ground.

**Result.**
