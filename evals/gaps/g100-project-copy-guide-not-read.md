---
id: g100
title: The product's own copy guide not read before writing
kind: missing
status: open
found: 2026-11-23
source: the person's design chats and a designs-to-code build on a client app with its own copy skill, usage logs of 2026-11-10 → 25
skill: [references/words/voice.md, SKILL.md]
sections: []
---

**What happened.** A client project keeps its voice in a copy guide of its own (a project skill
with approved texts and which form of address each audience gets); its DESIGN.md's Content section
only points to it. Design sessions wrote dozens of strings without opening it ("I didn't run it past
the" guide's reference texts, said one), mixed the formal and the neutral form of address on the same
screens, and wrote "Email" where the product writes it another way. The build from those designs
ended in a 300-string copy sweep in the code, and the person rewrote the guide twice to make the
split plain.

**The skill now.** `references/words/voice.md`, "The product's choices come first": "Read the copy
the product already has before writing: its screens and the strings in its code. DESIGN.md sets the
voice". It says nothing of a guide that DESIGN.md names, nor of a form of address (formal or informal,
the language's polite form) as a choice to keep.

**Proposed.** Candidate for that section: "When DESIGN.md's Content names a copy guide or a file of
approved texts, read it before the first word: reuse an approved text word for word where the screen
shows that block, and keep one form of address per audience, as the guide says. A string the guide
doesn't cover follows its register." And a Check row: "A form of address mixed on one screen → the
guide's form for that audience".

**Test.** A host whose DESIGN.md names a copy guide with approved texts and a formal register for one
audience, in a language with a polite form; briefs for a public page and an app screen, 2 runs each at
Opus: the share of approved texts reused verbatim and of strings in the right form of address,
shipped against the candidate.

**Result.**
