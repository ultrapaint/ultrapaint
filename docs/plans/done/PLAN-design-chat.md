# Plan: the design chat, an assistant that designs, checks and gets reviewed

Status: accepted, 2026-11-06, and built: ADR 0063. Builds on ADR 0060 (the council) and 0061
(checks before reviews), and replaces the UI part of `PLAN-review-loop.md` phase 5 ("Harnesses"); the
rest of that plan stands.

Mocks, in this folder: `design-chat/review-and-agents-settings.html` (frames 1–6: the Review
slider, Settings › Agents, the review models picker) and `design-chat/chat-transcript.html`
(frames A–E: a design run from the first prompt to done and when it goes wrong). Where they
disagree, the first is newer: frame A's Review popover and "Auto" chip, and every "Council" or
"Sign-off" in it, are superseded.

## Why

A design run today is a chat with an agent: tool calls folded in a list, a mode picker and a
model picker in the composer, and no review unless the agent remembers to start one (gap p08,
Claude 0 of 6). ADR 0060–0061 decided how a design should be made (an outline, checks at each
edit, a review by the models the person picks, until they approve), and the lab measured it.
None of it reaches the person in the editor. This plan builds it there, and makes the chat read
like an assistant at work on the method: what it will do, where it is, what the reviewers said,
what it decided, and the one question it needs answered.

## What the person sees

### 1. The composer

Two controls left of Send, as in the mocks: the **model menu** and the **Review chip**. The mode
picker goes.

- **Model menu.** The trigger shows the permission mode's icon (`MODE_ICONS`), the model and the
  effort: `✦ Opus 5.5 · High`. The menu: Agent, Model, Effort, then **Permissions** (a submenu,
  each mode with its icon, name and one-line description), the agent's other selects, its
  switches below a divider. The icon stays in the trigger in every mode, so "full access" is
  never hidden.
- **Review chip.** Reads the level: `Review: Standard`. A dot when the chat's level differs from
  the project's. Opens the slider popover (frames 1–4):

  | Stop | Line under the slider |
  |---|---|
  | Off | ● Not recommended. Nothing checks the design before it's done. |
  | Quick | Your first review model reviews until it approves. |
  | Standard | Your review models take turns, and all of them approve the result. Tag: Project default (on the project's level, whichever it is) |
  | Thorough | All your review models review every round. Slower, and the most thorough. |

  Header "Review"; at its right "Project settings", or "Use project default" once the chat
  differs. A project on Custom shows the chip as `Review: Custom`, the slider with no stop
  chosen and the line "Set in project settings." Choosing a stop makes the chat's own level.
  The chip is the design's start layer (ADR 0061): set before the first prompt or during the
  run, a change applies from the next round.

### 2. Settings › Agents

Groups, top to bottom: On this computer · **New chats** · **Review** · Design skills · Outside
the editor (frame 5).

- **New chats**: Agent, Model (as now), **Effort** (a segmented control of the agent's own
  levels: Low to Max for Claude Code, Low to High for Codex), **Permissions** (a select of the
  agent's modes, its description under the row). Changing the agent resets Model, Effort and
  Permissions to that agent's defaults. Kept for this project on this computer, applied at once,
  as Agent and Model are now: models and sign-ins are the machine's.
- **Review**: **Level** (segmented: Off · Quick · Standard · Thorough · Custom, the stop's line
  under the row), **Review models** (a select-like trigger listing them in turn order, opening
  the picker), and **Keep findings** (a switch: "Saves what reviewers find to
  ~/.ultrapaint/findings, so the design skill can learn from it."). Custom adds three rows:
  **Each round** (One · In turn · All), **Approval** (All review models · The round's reviewer),
  **Goal** (Until they approve · A score, with its number). Kept in `ultrapaint.config.json`
  under `review`, shared with the team, and saved with the section's Save as the design skills
  are.
- **Footer.** The "Applied at once…" sentence goes; the footer is Done alone, or Cancel and Save
  when the section holds unsaved edits. "Your edits in Repository aren't saved yet" with its
  Show button stays: it names something that would be lost. `DESIGN.md`'s rule ("a section that
  applies at once has a footer that says so") changes with it.

### 3. The review models picker (frame 6)

A popover from the Review models row, opening upward when the row is low:

- **In turn order**: one row per chosen model: drag handle, model, its agent, its effort (a
  compact select), remove. The order is meaningful: Quick uses the first, Standard and Custom's
  "In turn" go down the list.
- **Add a model**: a search field, then every model of every agent the editor has, grouped by
  agent, unchosen ones with a checkbox. An agent not signed in shows "Sign in" (the machine
  agents' action) and its models disabled with "Not signed in".
- An empty list is allowed; the review then uses the strongest model of each agent signed in
  (ADR 0060's default), and the row reads "Strongest of each agent".

The agents listed are the editor's (Claude Code, Codex, and custom ACP agents in the config).
Cursor and Gemini appear in the mock as examples; they appear for real only once they are
agents here (Cursor through `cursor-agent` as a custom agent, or built in later).

### 4. The transcript (frames B–E)

- **The plan, said once**: the agent's first message names the page and its sections in one or
  two sentences and the states each will have. No restatement after.
- **The run card**: one quiet card under it, updated in place, with the steps **Outline**
  (sections counted), **Build** (`3 of 4 · 2 fixed by checks`, the section in progress on a
  line below), **Review** (level and review models; during a review `Round 2 of up to 6`).
  The tool calls stay in the folded work lists where they happened: an agent's plan doesn't say
  which calls a step made, so the card's rows don't open (declined in review, 2026-11-06). Build's
  "fixed by checks" waits for the checks at each edit.
- **A round**: the reviewer, its round, its score or "No score" with why, "5 fixed", and each
  declined finding with the designer's reason (frame C). Reviewers looking show "Looking".
- **Done** (frame D): the card's head becomes "Approved by all 3 · 90–94 · 3 rounds" (or the
  goal met, or the cap reached with the best round kept and what was unmet); then the
  assistant's message: where the result is, each change named by its link, "three things you
  might not expect", what wasn't checked, and the one decision as a question card with its
  suggested answer. Under it the turn's end as now ("Done in 6m 12s · 1 page changed").
- **When it goes wrong** (frame E): a reviewer with no score is said once in its round and the
  next model in turn reviews instead; a stopped run says where it stopped, what is on the
  canvas, and offers Go on; a review that can't start names why and the fix ("Codex isn't signed
  in. Sign in, or take GPT-6.1-Sol out of your review models.").

### 5. The voice

Told in the briefing to a design thread, measured on the lab's rounds before it ships:

- Say the plan once, in at most three sentences; then work, without narrating each step.
- At the end: where it is, the changes by link, what the person might not expect (at most
  three), what wasn't checked; no recap of the request, no list of everything done.
- One question at a time, as a question with options and the one it suggests.
- Disagreeing with a reviewer is said in the round, with the reason, not in the final message.

## Decisions

| # | Decision | Choice |
|---|---|---|
| C1 | Name on screen | "Review models" for the council, "approve" for sign-off. The code and docs rename with it (`reviewModels`, `approval`), so one name holds everywhere, as AGENTS.md asks; the lab's `--reviewers` and `--sign-off` flags keep working as aliases |
| C2 | What a level is | A name for `on`, `eachRound` and `approval` together: Off (off), Quick (one, round's reviewer), Standard (in turn, all), Thorough (all, all). Custom is any other combination, or a goal set. Goal, when and the log are not part of a level |
| C3 | Where each setting is kept | Review: the project's config (`review`), shared. New chats: the project's state on this computer. The user layer of ADR 0061 waits until someone has several projects to share it across |
| C4 | A review model | Agent, model and effort (`{ agentId, model, effort? }`), its effort its own; the string form (`cursor:grok-4.7-high`) stays for the lab |
| C5 | Where the review runs | A server service started at the end of a design turn that edited pages, the reviewers headless ACP sessions in a read-only sandbox, their findings the designer's next prompt. The designer is never asked to start it (gap p08) |
| C6 | The run card | Drawn by the editor from what the transcript already holds (the agent's plan entries, its tool calls, the check results in them) and a new `review` item per round; no new tool for the agent, the MCP budget being tight |
| C7 | Mode in the trigger | Its icon always; name and description in the menu |
| C8 | What "Standard" means | Rotate and all, ADR 0061's defaults, until step 4 of `PLAN-review-loop.md` (after 2026-11-09) says otherwise; the levels are re-measured then |

## Contracts and data

- `contracts/review.ts`:
  - `ReviewModel` (C4) with `parseReviewModel` and `formatReviewModel` for the lab's strings.
  - `council` → `reviewModels`, `signOff` → `approval` (C1), with the decoder accepting the old
    keys once.
  - `ReviewLevel` = `off | quick | standard | thorough`, `LEVELS` (the settings each stands for),
    `levelOf(settings)` → a level or `custom`, `withLevel(settings, level)`.
- `contracts/settings.ts`: `review: Schema.optional(ReviewSettings)` in `common`, so it is in
  `Settings` and `ProjectConfig`.
- `contracts/threads.ts`:
  - `ChatDefaults` gains `effort` and `modeId`.
  - `Thread` gains `review` (the chat's override, a `Partial<ReviewSettings>`).
  - `ThreadItem` gains `review`: the round, its reviewers each with model, status
    (`looking | done | no-score`), score or the reason for none, findings fixed and declined
    (each declined one with its title and reason), and the verdict when it stops.
- `contracts/rpc.ts`: `threads.setReview` (the chip), `review.models` (every agent's models and
  efforts, signed in or not, for the picker).

## Server

- `ChatPreferences`: stores effort and mode; `optionsFor` applies them as it applies the model.
- `ReviewService` (`apps/server/src/services/review/`), a `Context.Service` with a scoped layer:
  - **Start**: at a design turn's end (`turn.ts` writes `turn_end`), when review is on and the
    turn edited pages; the settings are `reviewSettingsOf(thread.review, project.review,
    DEFAULT_REVIEW)`.
  - **Look**: pictures of the edited pages' sections, 2× in each theme (the open item of
    `contracts/screenshots.ts` is closed here: a scale and theme in the request), their code,
    and the checks' results.
  - **Reviewers**: `reviewersOfRound` picks them; each a fresh ACP session through `AcpAgent`,
    its model and effort set, the sandbox read-only for the whole repository (a profile
    `packages/acp/sandbox.ts` gains), told the skill's review role
    (`PLAN-review-loop.md` phase 4) and answering in `Finding`'s schema. Five minutes, then
    "No score" and the next model in turn takes the round.
  - **Score and stop**: `sectionScore`, `pageScore`, `verdictOf`; a `review` item per round,
    updated as reviewers answer.
  - **Answer**: unless stopped, the findings go to the designer as its next prompt, marked as the
    review's, and the loop goes on at that turn's end. Approval by every model ends it.
  - **Log**: with Keep findings on, each finding and what the designer did with it appended to
    `~/.ultrapaint/findings/<project>.jsonl` (`LoggedFinding`).
  - **Stop**: the thread's Stop stops the review's sessions too, through the scope that started
    them.
- `briefing.ts`: the voice (§5), and for the plan entries the run card reads: "Outline", then one
  "Build <section>" each, then nothing for the review, which is the editor's.

## Phases

Each phase ends with `pnpm typecheck`, `pnpm test`, `pnpm lint`, a commit to main, and the app
run and screenshot (local headless Chrome) for what it changes on screen.

1. **ADR 0063 and the contracts.** The ADR (C1–C8); GLOSSARY ("Review models", "Approval",
   "Review level", "Run card"); the contracts above, tests first for `levelOf`, `withLevel`,
   `parseReviewModel` and the old keys; the evals renamed to match. `DESIGN.md`'s footer rule.
2. **The model menu and New chats.** Permissions into the model menu with the icon in the
   trigger; `ModePicker` removed; Effort and Permissions in New chats; `ChatPreferences` applying
   them. Tests: the pickers' menu (Permissions listed with descriptions, the icon per mode), the
   settings group (an agent change resets the rest), `optionsFor` with effort and mode.
3. **The review engine.** `ReviewService` against `packages/acp/scripted-agent.ts` reviewers:
   a round started at a turn's end, none when no page changed or review is off; "No score" after
   the timeout (`TestClock`) and the next model taking the round; findings sent to the designer;
   stop on approval, goal, caps; the log written only when on; a reviewer's write refused by
   the sandbox. Then one real run on a lab reference with Opus designing and GPT-6.1-Sol
   reviewing, its cost noted.
4. **Review settings.** The Review group (Level, Review models, Keep findings, Custom's rows),
   the picker (order by drag and keyboard, effort, search, signed-out agents), the footer; then
   the chip and its slider, `threads.setReview`, the dot and "Use project default". Tests: the
   level shown for each combination, Custom's rows, the chip's override reaching the service.
5. **The transcript.** The run card from plan entries, tool calls and `review` items; a round's
   rows; done and its head; the failure states of frame E; Go on. Tests on the card's
   derivation (pure, in `apps/web/src/lib/`) for frames B–E's transcripts.
6. **The voice.** The briefing's rules (§5); a lab round before and after on three references,
   comparing message length and the person's read of two runs side by side. Kept only if it
   reads better.
7. **Check it.** `measure --checks --hover` on the composer, the popovers and Settings › Agents in
   both themes; the review models (Opus, GPT-6.1-Sol, Grok 4.7) reviewing the built screens; the
   findings fixed or declined with reasons; gaps filed for what the skill missed.

Phases 2 and 3 are independent and can run in parallel; 4 needs 1 and 3 (no setting ships before
it does something); 5 needs 3; 6 can start after 1.

## Later, not in this plan

- Reading review settings from the request's words ("Opus and Grok, until 90") into the chip.
- The user layer of settings (C3).
- The outline's checklist and the review role in the skill: `PLAN-review-loop.md` phase 4,
  after its experiment. Until then the run card shows Outline only when the agent writes one.
- The checks at each edit in the write tools (that plan's phase 5): Build's "fixed by checks"
  appears once they report.
- Budget in money on screen: the caps run, but cost per run is shown only when the agents report
  it.
- The editor's left card tone step (0.011 → ~0.045 apart, ADR 0061).

## Open

- Pictures for reviewers: one per section or per page, and at what width for a page wider than
  800px. Decided in phase 3 from the lab's `recall` numbers.
- Whether a chat's review level is kept on the thread after the run (to resume) or reset to the
  project's for the next prompt.
