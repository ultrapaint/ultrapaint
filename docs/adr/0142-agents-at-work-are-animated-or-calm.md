# ADR 0142: Agents at work are Animated or Calm, the person's choice

Status: accepted, 2026-11-24. Amends 0018 (the light passing through), 0093 (Appearance's
preferences).

## Context

0018 marks what an agent changes with a pink outline and a light passing through it, again and
again until the turn ends; 0098 draws a variation still being made the same way. A designer who
works beside an agent for minutes has it moving in the corner of their eye, and the only way to
stop it was Motion, which stops every animation in the editor. Motion did not stop it well
either: Reduced cut the animation to one run and left the gradient on its last frame, and System
took the animation off through a media query that left the gradient at its first. That query
read only the computer's setting, so Full never brought the sweep back on a computer that asks
for reduced motion.

## Decision

- **Agents at work**, a preference of Appearance's Interface group under Motion: **Animated**
  (the default) or **Calm**, "Calm marks what an agent is changing with a still outline."
  `agentsAtWork` in `Preferences`, kept in the profile with Appearance's other values; a value
  that is not one of the two is Animated.
- The light passes through an agent's work (`AgentWorkOverlay`) and a take still coming
  (`TakeBox`) only under Animated with motion not reduced (`agentSweeps`, `useAgentSweeps` in
  `state/preferences.ts`). Motion is reduced under Reduced, and under System when the computer
  asks for it, heard through `matchMedia` so a change redraws; never under Full. Otherwise the
  outline is drawn alone, with no fill: never a gradient stopped in place.
- The overlays decide in code, not the stylesheet: Calm takes the gradient away and not only its
  animation, and the editor's tests see the class in happy-dom, where no media query is read.
  `agentsAtWork` is not drawn on the root, and the stylesheet's rule taking `animate-agent-sweep`
  off under the computer's reduced motion is gone.
- What stays: the working dot, the chat's shimmer, the "Changed" fill at a turn's end, the
  preview's skeletons and the agent's pink.

## Consequences

- Full now means what its row says for the canvas's agent work.
- The two overlays' outlines are written as longhands (`outlineColor`, `outlineStyle`,
  `outlineWidth`), which the tests' DOM keeps where it drops a shorthand holding a `var()`.
