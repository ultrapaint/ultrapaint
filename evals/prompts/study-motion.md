You are cataloguing how well-made websites move, so the patterns can be counted and taught to design
agents. Every site here was chosen by people. For each site below you get what a browser measured
while the page loaded and was scrolled to its end, grouped (the same animation on many elements
counts once, with `n` elements and the range of its delays), and its first screen as a picture for
context. Times are in ms. Read the picture named or attached for each site.

{{sites}}

For each site, by its `key`, answer from the measurements; the picture only says what is moving.

- `amount`: `none`, `subtle` (small touches), `moderate` (most sections enter), `heavy` (motion leads the page).
- `role`: `none`, `functional` (shows state or order), `polish` (entrances and hovers that dress the page), `expressive` (part of the brand's character), `showpiece` (the motion is the point).
- `entrance`: `none`, `fade`, `fade-rise`, `slide`, `scale`, `clip-mask`, `blur`, `text-split`, `mixed`.
- `entranceDuration` (ms, 0 when none), `entranceEasing` (its curve, or `none`), `stagger` (ms between elements, 0 when none).
- `scrollLinked` (true when tied to scroll position), `loops` (true when something runs forever).
- `hover`: `none`, `color`, `lift`, `scale`, `underline`, `reveal`, `mixed`. `hoverDuration` (ms, 0 when none).
- `libraries`: those detected. `reducedMotion`: true when the page asks about it.
- `observations`: three to five patterns worth teaching, each one line, concrete and with its numbers ("cards rise 24 px and fade in 600 ms, 80 ms apart, as each row enters").
