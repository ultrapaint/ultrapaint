# Title screen

A game's site or title screen, or any entry gate to an experience: one fixed scene, one way in.
Past the gate, a game's site is a landing page (`references/pages/landing.md`).

Open with it, before the first element: `references/typography.md`, `references/motion.md`.

## One screen

- One fixed full-bleed scene, in 3D or flat illustration, darkened under the title; photographs
  almost never.
- Nothing scrolls until the player starts. No navigation bar.
- The scene carries the title, one start control, a sound toggle and nothing else; an optional
  thin chevron when the page does scroll below.

## The title

- The headline is the title itself: `1–4` words, a lockup more often drawn than set (pixel or
  bitmap letters, extruded 3D letters, a swashed serif). No subhead.
- Menu items are small pixel or mono words, set like a console menu.
- The game's own interface text (settings, a store, an account) stays in the product's sans.

## The way in

- One large button with one word: "Play", "Begin", "Start", "Enter".
- If sound matters, one small line by the button or in a hairline strip: "Best with sound".
- The only second action is an escape: "Skip intro", "Enter without sound".
- The sound toggle is a small outlined square or a word ("Sound: on") in a bottom corner.
- Store badges keep their official form.

## Colour

A dark or black ground with one glowing accent (cyan, teal, lime) used as light; the start
button may be its one fill. Celebration lives in the scene's colour and motion where something is
won, never in added badges.

## Motion

The scene lives through slow loops, out of step by duration:

- `Always · scene layers (clouds, hills) · translateX drift · 20000–90000ms each · linear · negative delays so it is mid-drift on load`
- `Always · small figures, badges · gentle bob or breathe · 2000–5000ms each, alternating, out of sync`
- Under reduced motion every loop stops and the scene stays as it was drawn. An intro is short
  and skippable; the start button is on screen at once.

## Check

| You see | Fix |
| --- | --- |
| Photographs and a scrolling list of features | One scene, one start button, a sound toggle |
| Two or more buttons of equal weight | One start; an escape at most |
| A navigation bar over the title screen | None; the scene and the start |
| Loops still running under reduced motion | Stop them |
