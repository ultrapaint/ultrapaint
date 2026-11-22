# ADR 0110: The design skill names capabilities, not the editor

Status: accepted, 2026-11-22, measured on gap p13 (recall held). Amends 0069 (the web's terms)
and 0062 (the token presets in the skill).

## Context

The design skill ships on its own (`npx skills add`) and is what the editor tells its design
threads, review models and outside agents. 0069 took the editor's page format and markers out of
it, but some of its lines were still written for the editor: step 6 answered "an editor's review
loop"; `references/color.md` said a design system names its tokens "in one of two presets", the
editor's `TokenPreset`; examples came from the editor's own screens (a size on a frame, a change
badge, an inspector beside a canvas); `references/system/components.md` made a component only the
React way. What the skill can use where the agent has it (a question tool, another agent) was said
in passing, step by step, and the briefing's `skillTerms` mapped some of it with nothing to say
which. The guard test caught the editor's tool names and fields, not its name or its words.

## Decision

- **The skill names nothing of the editor but its own name.** `name: ultrapaint` and the title
  `# Ultrapaint` stay: they label the skill. Nothing else in it says Ultrapaint, the editor, a
  review loop or a token preset.
- **Capabilities, named once.** The core's "Where you work" lists what an agent may have beyond
  files and a reply: a question tool, another agent, a reviewer that sends findings, a view at a
  width, the design system's store, a component's documentation. A step that can use one names
  it in those words and says what it does without it.
- **The briefing maps them.** `skillTerms` has a line per capability the editor gives, in the
  skill's words: the store is `read_design_system` and `write_design_system`, the question tool
  `ask_user`, a component's documentation `get_component`, a view at a width `get_screenshot`;
  without the editor's tools, the store is the files and the documentation the components' list.
  The reviewer is the editor's review loop, said with the loop where it reviews the chat, never
  where it does not. "Another agent" is the agent's own.
- **Tokens keep the system's names.** `color.md` gives roles and tokens by property and meaning as
  the two common forms, not as the only two; the briefing keeps saying which one a project of the
  editor uses (`DETAILED_NOTE`).
- **Components by principle.** `system/components.md` states one map of variants, typed props,
  the screen's styling on the outer element and an icon by name, with React (`cva`, `className`)
  as one example.
- **A test holds it** (`apps/server/src/skills/skills.test.ts`): the skill names nothing of the
  editor past its title ("Ultrapaint", "the editor", "review loop", a token preset: "editor",
  "canvas" and "preset" alone are ordinary words of the rules, an editor's toolbar or a date
  preset); each capability is named in "Where you work" and used by a step; each the editor gives
  has its line in `skillTerms`, the reviewer its line with the review loop.

## Consequences

- An agent outside the editor reads no step it cannot follow; one inside it reads the same skill
  and the briefing's lines for the capabilities.
- A new thing the editor gives an agent for a step is a capability: one line in "Where you work"
  and its line in `skillTerms`, never the editor's name in a step.
- The skill's core grows by its "Where you work", about 120 words.
