# Motion on well-made sites: a reference

This reference covers what 662 people-chosen sites do as they load and are scrolled to the end, as measured by a browser. It adds 300 of those sites read one by one, each with a character where its note gives one: 28 technical, 59 humanistic, 187 expressive. Use it alongside the motion and character skills. Section 4 says where the two disagree and which one wins.

Counts are marked "% of 662" when they come from the measurement and "n of 300" when they come from the notes.

## 0. What this can and cannot see

- **Load and scroll only.** Hover numbers are the transitions declared on hoverable elements: their duration, curve and properties. They do not show what a hover looks like. Whether a `transform` is a 2 px lift or a 1.1 scale was never seen.
- **Nothing behind a click.** Menus, dialogs, drawers, sheets, toasts and palettes are unmeasured. The skill's sections 3 and 4 on these rest on the skill alone. A handful of notes caught one in passing, too few to count:
  - stripe-bfcm dropdown: background 200 ms, opacity 250 ms.
  - turo popover: scaleY(0.9) to 1 in 300 ms.
- **These are websites.** They are landing, brand, editorial and commerce pages. "Technical" here means the site of a technical product, not its admin screens. Nothing here measures a dashboard, so the skill's rules for product interfaces stand.
- **Leave out 8 of the 300 notes.**
  - Six captures reached a spam page instead of the site.
  - Two never reached the site: hex-test, the-society.
  - They are all glows and endless loops, and they inflate the loop counts. Third-party chat loaders and email popups are not the site's own motion either.

Curves are written out where they are named. The CSS keywords stand for these curves:

| Keyword | Curve |
| --- | --- |
| `ease` | `cubic-bezier(0.25, 0.1, 0.25, 1)` |
| `ease-out` | `cubic-bezier(0, 0, 0.58, 1)` |
| `ease-in-out` | `cubic-bezier(0.42, 0, 0.58, 1)` |
| `ease-in` | `cubic-bezier(0.42, 0, 1, 1)` |
| Tailwind default | `cubic-bezier(0.4, 0, 0.2, 1)` |

## 1. What holds in every character

### Most of the page is still

- **How much moves:**
  - 30% of 662 sites run no animation at all.
  - 49% have no entrance.
  - In the notes, 131 of 300 have no entrance. Amount is subtle on 165, moderate on 83, heavy on 47 and none on 5.
- **Stillness is not a technical-only habit.** No entrance on 11 of 28 technical, 28 of 59 humanistic and 77 of 187 expressive sites.
- **Static pages succeed on type and image alone:** foundation, sound-ethics, ana-rita-morais, akron-street, confetti-studio, mjc-la-bouvardiere.
- **What people read stays still.** News and magazine fronts move only their chrome and their loading images: the-new-yorker, time, advertising-age, compact-mag.
  - Splitting body copy into hundreds of fading spans is rare and not to copy: terminal-industries (680 spans), af1 (898 spans).

Name the one thing on the page that moves before anything else. The default is nothing.

### Content enters by opacity, with a short rise

- **Opacity carries entrances.** Measured tracks: opacity 672, transform 438, both together 167, filter 57, scale 18.
- **Entrance types in the notes:** fade 60, mixed 37, fade-rise 34, text-split 13, slide 10, clip-mask 6, scale 5, blur 4.
- **Rises are short.**
  - The most common measured starts are `translateY(20px)` and `translateY(8px)`, 14 each.
  - In the notes, rises run 8–32 px, most often 16–24 px.
- **Duration:**
  - Measured: median 600 ms, p25 400 ms, p75 1000 ms.
  - Notes: median 666 ms (n 167).
- **An entrance fires once,** as the block crosses into view. It does not replay when the reader scrolls back up.

Default: opacity `0`→`1` with `translateY(20px)`→`0`, `600ms`, range `400–800ms`.

### One strong ease-out, used everywhere

- **Measured entrance curves:**

  | Curve | Tracks |
  | --- | --- |
  | `ease` | 309 |
  | `ease-out` | 124 |
  | `cubic-bezier(0.22, 1, 0.36, 1)` | 112 |
  | `linear` | 104 |
  | `cubic-bezier(0.16, 1, 0.3, 1)` | 87 |
  | `cubic-bezier(0.4, 0, 0.2, 1)` | 75 |
  | `ease-in-out` | 71 |
  | `cubic-bezier(0.19, 1, 0.22, 1)` | 31 |
  | `cubic-bezier(0.2, 0.7, 0.2, 1)` | 29 |
  | spring `linear()` | 26 |

- **The expo-out family** (`0.16/0.19/0.22/0.23, 1, …`) totals 230 tracks. It is second only to `ease`, and it is what sites pick when they write a curve at all.
- **An entrance on `ease-in` is almost absent:** 3 of 167 noted entrances.
- **Twelve notes use one house curve** for every entrance and every hover, and read as one system:

  | Site | House curve |
  | --- | --- |
  | pizzato | `cubic-bezier(0.19, 1, 0.22, 1)` |
  | ma | `cubic-bezier(0.16, 1, 0.3, 1)` |
  | sons-and-daughters | `cubic-bezier(0, 0, 0.2, 1)` |
  | ritual | `cubic-bezier(0.165, 0.84, 0.44, 1)` |
  | theatre-de-quatsous | `cubic-bezier(0.33, 1, 0.68, 1)` |
  | authentic-form-and-function | `cubic-bezier(0.2, 0.7, 0.2, 1)` |
  | romance-journal | `cubic-bezier(0.645, 0.045, 0.355, 1)` |

  The others are kpr-ramen-wars, spot-studio, gardener, chrysler-museum-of-art and atelier-vaste.

Default:
- Every entrance: `cubic-bezier(0.23, 1, 0.32, 1)`.
- Hover colour: `ease`.
- Loops: `linear`.
- Nothing else, unless the design system names a house curve.

### Stagger

- **How often:** 78 of 300 sites stagger, at a median of 100 ms.
- **Measured groups:** median 150 ms, p25 72 ms, p75 500 ms (685 groups). The upper end includes whole waves, not gaps between neighbours.
- **Blocks in a row: 70–120 ms apart.** canopy 90, conductor 75, captain-toucan 120, brikkenco 120, tdf 80, housemait 80, medium-rare 70, viewport-2 about 100–120.
- **Split text: 15–30 ms per word or character.** pizzato 15, david-alaba 15, vooban 30, digital-design-days 30.
- **Fixed delay steps keep long grids short.** Sites that pick from a few fixed steps instead of stepping per index never cascade for seconds: kulfi-beauty, lucas-vocos, intent-hq.

Default: `80ms` between blocks, at most 6 steps, and the whole cascade finished within `500ms` of the first block.

### Bigger moves further and takes longer

These sites scale travel and time with the element:

- **conductor:** small items rise 16 px in 400 ms, blocks 24 px in 500 ms, hero lines 40 px in 800 ms.
- **micro:** rows clear blur(4px) in 350 ms; tiles clear blur(10px) in 550 ms.
- **Small controls against large surfaces:**
  - omega: 200 ms against 320 ms.
  - nitex: 150, 300 and 500 ms.
  - mouthful-of-dust: 200 ms against 1000 ms.
- **naughtyduk-c-2:** line length sets the draw time.
- **intent-hq:** the inverse inside one stack. Each later element rises less and finishes sooner, so the stack lands together.

### Hover: colour, quick, plain curve

- **How common:** 73% of 662 sites declare hover transitions.
- **Duration:** median 200 ms, p25 150 ms, p75 300 ms. Notes median 250 ms (n 241).
- **Properties:** color 379, `all` 223, opacity 216, background-color 136, transform 128, background 73, box-shadow 27, border-color 20.
- **Curves:** `ease` 557, `cubic-bezier(0.4, 0, 0.2, 1)` 259, `ease-in-out` 82, `ease-out` 44, `linear` 44.
- **Notes:** colour-only 120, mixed 105, none 59, reveal 7, scale 5, underline 3, lift 1.

Default:
- Change `color`, `background-color` or `opacity` in `150–200ms`, curve `ease`, each property named.
- Use `transform` only on a card or a pressed button. The study cannot say how far a hover should move.

### Loops are slow, linear, and gated

- **163 of 300 sites loop.** The common, useful loop is a marquee: `translateX` on `linear` at 20–90 s per cycle, slow enough to read.
  - jam 88.6 s, captioneer 70–76 s, micro 24–32 s, viewport-2 44 s, techspeed 40 s, wegems 40 s, misfits-market 25 s, leep 60/85/100 s.
- **Neighbouring loops fall out of step by duration, not delay.**
  - micro runs 24, 28, 30 and 32 s.
  - herd runs 29–48 s with negative delays of −5 to −37 s, so the layers are already mid-cycle on first paint.
- **Spinners turn once per `1000ms`, `linear`.**
- **Most sites never ask about reduced motion.** It is checked by 34% of 662 and 106 of 300.
  - Endless loops run ungated on fitonist (238 dots), quechua (letter wiggle), the-lookback (film grain) and mat (text shimmer).

### Smooth scroll and scroll-linking are extras

- **Smooth scroll:** Lenis on 15% of 662 and 66 of 300, 51 of them expressive.
- **Scroll-linking:** scroll-driven motion on 7% of 662; scroll-linked on 28 of 300.
- **They add weight, not meaning.** Leave both off unless the brief asks for them.

## 2. By character

| | Technical (28) | Humanistic (59) | Expressive (187) |
| --- | --- | --- | --- |
| No entrance | 11 (39%) | 28 (47%) | 77 (41%) |
| Heavy motion | 6 (21%) | 2 (3%) | 35 (19%) |
| Entrance median | 750 ms (n 17) | 600 ms (n 31) | 600 ms (n 108) |
| Most common entrance curve | `cubic-bezier(0.16, 1, 0.3, 1)`, 4 of 17 | `ease`, 11 of 31 | `ease`, 29 of 108 |
| Stagger median | 100 ms (n 12) | 167 ms (n 10) | 90 ms (n 50) |
| Hover median | 200 ms (n 27) | 200 ms (n 54) | 300 ms (n 139) |
| No hover transition | 1 | 5 | 48 (26%) |
| Loops | 15 (54%) | 38 (64%) | 94 (50%) |
| Smooth scroll | 6 (21%) | 6 (10%) | 51 (27%) |
| Reduced motion checked | 16 (57%) | 28 (47%) | 50 (27%) |

Technical and humanistic samples are small. The stagger rows rest on 12 and 10 sites; read them as direction, not value.

### Technical: motion acts out the product

- **Scripted demos show what the product does.** In 8 of 28 the motion is a demo, the skill's "explanation" purpose:
  - kelvin-zero: a passwordless login plays out. Button press 150 ms; a "captured" label rises 4 px in 300 ms.
  - canopy: a post writes itself; "thinking" dots pulse on a 720 ms loop.
  - pairio: a remote cursor flies in over 700 ms and a chat bubble pops from scale(0.8) in 280 ms.
  - The others are f13, rig, micro, walbi and slack.
- **Entrances** are a 10–24 px fade-rise on `cubic-bezier(0.16, 1, 0.3, 1)`.
- **Blur, 4–10 px,** clears only on headings: viewport-2, humanoid-index, micro, captioneer.
- **Timer bars** show when an auto-advancing tab will change (recipe 6).
- **Technical sites check reduced motion** more often than any other character.
- **For the product's own screens there is no evidence.** The skill's table stands.

### Humanistic: the quietest

- **Heavy motion almost never:** 2 of 59.
- **Entrances** are a plain fade or a 16–40 px fade-rise on `ease`, 600–1000 ms.
- **Life comes from slow loops in the illustration,** not from entrances:
  - maxima-therapy: clouds drift on a 20 s loop.
  - cozy-hollow: six cloud layers at 40–90 s, with negative delays so the sky is mid-drift on load.
  - playdate: clouds breathe at 3–5 s, out of sync.
  - my-merry-miles: icon badges bob at 2–3 s.
- **Commerce chrome carries the rest:**
  - The header (recipe 5).
  - Carousels at 300 ms.
  - Popups fading in over 350 ms.
- **Celebration belongs where something happens.** plastic's confetti falls for an anniversary, not on arrival.

### Expressive: freer, and still often still

What expressive sites add:
- **Slower hovers:** median 300 ms, up to 500–1000 ms on large surfaces.
- **Headlines rising from masks** (recipe 4).
- **Clip-path image wipes:**

  | Site | Wipe | Time | Curve |
  | --- | --- | --- | --- |
  | lpas | `inset(40% 0 0)` | 1200 ms | `cubic-bezier(0.14, 0.83, 0.4, 1)` |
  | medium-rare | `inset(0 100% 0 0)` | 920 ms | `cubic-bezier(0.76, 0, 0.24, 1)` |
  | waabi | cards open | 600 ms | `cubic-bezier(0.645, 0.045, 0.355, 1)` |

- **Sections that retheme as they pass, in 12 sites.** Background and text colour cross-fade in 300–600 ms.
  - kenkashi 300 ms, wolff-olins 500, ma 500, here 500, brikkenco 600, red-antler 600.
  - The others are the-workshop, impactor, tesoro-1, lightweight, zentry and shortstop.

What to keep in mind:
- **41% have no entrance and 26% no hover transition.** A brand page may let type carry it.
- **Don't copy these:**
  - Intros that hold content back: metropolis 2800 ms; af1 3000 ms; pilot-republick 7200 ms; manuel-sofia's header at 7000 ms.
  - Panels sliding 900 px with no reduced-motion gate: pop-up-10-ans.
  - A 1250 ms page-builder fade that reads sluggish: jerome-harris.

## 3. Recipes

Each recipe ends with its line for the canvas note: trigger · what moves · duration · curve.

### 1. Section reveal: blocks fade and rise as they enter (14 notes)

- **Values:**
  - Blocks rise 16–24 px and fade from 0 in 600–800 ms on `cubic-bezier(0.16, 1, 0.3, 1)`.
  - They fire once, as each block enters.
  - Blocks in a row are 80–120 ms apart.
- **Sites:**

  | Site | Rise | Duration | Curve | Apart |
  | --- | --- | --- | --- | --- |
  | viewport-2 (about 290 elements) | 10–20 px | 620–820 ms | `cubic-bezier(0.16, 1, 0.3, 1)` | 100–120 ms steps |
  | canopy | 18 px | 900 ms | `cubic-bezier(0.16, 1, 0.3, 1)` | 90 ms |
  | authentic-form-and-function | 22 px | 900 ms | `cubic-bezier(0.2, 0.7, 0.2, 1)` | 90 ms |
  | tdf | 18 px | 900 ms | `cubic-bezier(0.2, 0.7, 0.2, 1)` | 80 ms |
  | housemait | 14 px | 700 ms | `cubic-bezier(0.2, 0.7, 0.2, 1)` | 80 ms |
  | pairio | 24 px | 500 ms | `ease-out` | 100 ms |
  | conductor | 24 px | 500 ms | `ease-out` | 75 ms |
  | captain-toucan | 16 px | 520 ms | `cubic-bezier(0.22, 1, 0.36, 1)` | 120 ms |

  Also ycn-2016, kona-coffee, joby, marina-rachello, uni and vid2txt.
- `Scroll into view · section blocks · opacity 0→1, translateY(20px)→0 · 700ms · cubic-bezier(0.16, 1, 0.3, 1) · 80ms apart`

### 2. Hero sequence: content first, chrome last (6 notes)

- **Values:**
  - The headline comes first, then the supporting line, then the action, 150–300 ms apart.
  - Each later element travels less and finishes sooner.
  - The navigation lands last, or does not move at all.
  - The action is visible within 1 s.
  - An eyebrow only appears if the brief asks for one.
- **Sites:**
  - intent-hq:

    | Element | Rise | Duration | Starts |
    | --- | --- | --- | --- |
    | h1 | 30 px | 900 ms | 200 ms |
    | paragraph | 24 px | 800 ms | 500 ms |
    | buttons | 20 px | 700 ms | 750 ms |

    All on `cubic-bezier(0.16, 1, 0.3, 1)`.
  - humanoid-index: the navigation arrives 150 ms after the content.
  - tdf: headline lines 150 ms apart; the navigation comes at 1050 ms.
  - canopy: the product window lands at 470 ms, after the copy.
  - conductor: the two headline lines are 350 ms apart.
  - kaiunta: 200 ms apart and 1.6 s in total, which is too long. It also stages an eyebrow, which principle 1 removes.
- `Load · headline, then line, then action · opacity 0→1, translateY(24px)→0, each 100ms shorter · 800ms · cubic-bezier(0.16, 1, 0.3, 1) · 200ms apart`

### 3. Media fades as it loads (20 notes)

- **Values:**
  - Opacity 0→1 in 300–600 ms, with no movement and no stagger.
  - The image's load triggers it, not the scroll.
  - A placeholder holds the space so nothing jumps.
  - Opacity-only fades are safe without a reduced-motion gate.
- **Sites:**
  - sam-george 500 ms `ease`; intern-magazine 500 ms `ease`.
  - wgp-architects and thibaud 300 ms `cubic-bezier(0.4, 0, 0.2, 1)`; snohetta 600 ms; jean-stories 200 ms `linear`.
  - Two-step versions:
    - grafik fades a blurred placeholder in over 350 ms, then the full image over 600 ms. It hides the placeholder at 600 ms, exactly when the fade ends.
    - pact-studio clears the image from blur(10px) in 330 ms.
  - Also adam-ho, lm-chabot, inverse, cinemateket, lpas, maisonette, margaret-rajic, invisible-folio, nikolai-dobreff, baggy, previously-unavailable and ben-barry.
- `Image loaded · image · opacity 0→1 · 400ms · cubic-bezier(0.4, 0, 0.2, 1)`

### 4. Display headline rises from a mask (expressive only, 8 notes)

- **Values:**
  - Words or lines rise from `translateY(105%)` inside `overflow: hidden`, 800–1200 ms on `cubic-bezier(0.19, 1, 0.22, 1)`.
  - Words are 15–30 ms apart; lines are 30–150 ms apart.
  - One display headline per screen; body copy never.
- **Sites:**

  | Site | From | Duration | Curve | Apart |
  | --- | --- | --- | --- | --- |
  | pizzato | 105% | 1000 ms | `cubic-bezier(0.19, 1, 0.22, 1)` | 15 ms |
  | vooban | 110% with rotate(10deg) | 800 ms | `cubic-bezier(0.53, 0, 0, 1)` | 30 ms |
  | chris-biron | 100% with a 7deg tilt | 666 ms | `ease` | line by line |
  | david-alaba | yPercent | 1500–1620 ms | custom | 15 ms; lines 30 ms |
  | animus-studios | about 69 px | 1000 ms | expo-out | 150 ms |

  Also metropolis, digital-design-days and alpine-bio. Text-split appears on 13 of 300 sites, 8 of them expressive.
- `Scroll into view · headline words · translateY(105%)→0 in mask · 1000ms · cubic-bezier(0.19, 1, 0.22, 1) · 20ms apart`

### 5. The header answers the scroll (19 notes, every character)

- **Values:**
  - The header hides on scroll down and returns on scroll up: `translateY` in 200–400 ms.
  - Once past the hero, its background fills from transparent in 200–300 ms.
  - It compacts in 300–500 ms by scaling the logo, not by animating height.
- **Sites:**
  - ai-milestones 200 ms `ease`; wozere and studio-size 300 ms `ease-in-out`.
  - omega 400 ms `cubic-bezier(0.39, 0.575, 0.565, 1)`.
  - theatre-de-quatsous 300 ms `cubic-bezier(0.33, 1, 0.68, 1)`.
  - the-new-yorker 300 ms `cubic-bezier(0, 0.59, 0.32, 1)`; el-burro 500 ms `cubic-bezier(0.23, 1, 0.32, 1)`.
  - get-vesto and bricklane 200 ms; good-pair-days and turo 300 ms.
  - Also bite, gitman-bros, majority, pact-studio, 1040, joby, techspeed and sons-and-daughters.
- `Scroll down/up · header · translateY(-100%)↔0 · 300ms · cubic-bezier(0.23, 1, 0.32, 1)`
- `Past hero · header background · opacity 0→1 · 200ms · ease`

### 6. Loops with a job: slow ticker, timer bar

- **Ticker (more than 40 notes):**
  - One per screen: `translateX` on `linear` at 30–90 s per cycle, readable while it moves.
  - Neighbouring rows differ by a few seconds.
  - Paused under reduced motion and when off screen.
- **Timer bar (6 notes):**
  - The bar runs `scaleX(0)`→`1` on `linear` over exactly the slide's time. It shows when an auto-advancing tab will change.
  - Sites:
    - intercom: 7000–30000 ms.
    - slack: 8000 ms, and 28000 ms on the video carousel.
    - micro: 7000 ms.
    - pairio: 5000 ms, built on `width`; use `scaleX` instead.
    - rig: a step fills over 6000 ms.
    - rumsey-taylor: an SVG ring draws over 3000 ms.
- `Always · logo row · translateX 0→-50% · 60000ms · linear · paused under reduced motion`
- `Tab active · progress bar · scaleX(0)→1 · 8000ms · linear`
