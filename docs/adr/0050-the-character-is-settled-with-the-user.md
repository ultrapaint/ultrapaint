# ADR 0050: The character is settled with the user and written in DESIGN.md

Status: accepted, 2026-11-03. Amends 0049 (a project with no system, the taste rules).

## Context

The character (technical, humanistic, expressive) set the dials every reference leaves open, but
the agent named it in its head at the start of each job: from the design system, the brief, or
the kind of product. Nobody asked the user, nothing recorded it, and the next screen named it
again. Three kinds were also too coarse ("warm, rounded, but dense" is none of them), and some
dials were fixed rules: neutrals never blue-grey, interface text never serif, whatever the
product was meant to feel like. The two-jobs rounds lost likeness where those rules beat the
reference (a heavy fallback headline, a green-tinted row made grey).

## Decision

- The user says the feel (who the product is for, how it should feel, a product it should feel
  like, a brand colour); the agent completes the rest on seven dials (temperature, density,
  shape, accent, type voice, imagery, tone), the three kinds being presets for the dials the user
  left open.
- It is read before it is asked: DESIGN.md, else the design system, the product's code or
  pictures, a Figma file, a picture to remake, or a request that already says it. When nothing
  says it, the agent asks once, before the first node, with two options in this order: decide
  from my request, or I'll describe it. Nothing else is asked; without a way to ask, the agent
  asks in its reply.
- It is written in DESIGN.md, the open format, while the design is made: the Overview holds the
  character in the user's words, a named reference and the dials in one line; the tokens hold
  what the dials chose. A project with no system gets one before its first screen, with the
  foundations in that character; the agent tells the user in three lines what it chose.
- What the user said of the feel wins over the references' taste defaults: a cool, clinical
  product gets blue-grey neutrals, a literary one a serif. Quality does not bend: contrast, the
  type floors, targets, restraint. A picture to remake is the character, so its tints and face
  win too.
- In the app the question is asked in chat (`ask_user`), the same path as outside it; the
  Define step's question card asks for the feel first, and DESIGN.md's guide asks the Overview
  for the character and its dials. No field in the panels yet.

## Consequences

- The design evals answer the question with its first option, so a round on a blank host decides
  from the request and writes a design system before drawing: rounds there are not comparable
  with earlier ones.
- A thread drawing in a project with no system writes one (`write_design_system`), which Sync
  then compares with the code like any other.
