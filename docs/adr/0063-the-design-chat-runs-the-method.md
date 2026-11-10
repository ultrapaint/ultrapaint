# ADR 0063: The design chat runs the method, and the person sets how much review it gets

Status: accepted, 2026-11-06; amended the same day by the lab (the lighter review, below). Builds on 0060 (the council) and 0061 (checks before reviews), and
replaces the editor part of `docs/plans/PLAN-review-loop.md` phase 5. Plan:
`docs/plans/done/PLAN-design-chat.md`, mocks in `docs/plans/done/design-chat/`.

> Amended by [0066](0066-findings-are-kept-by-the-person-and-triaged-into-gaps.md), 2026-11-06:
> keeping the findings is the person's choice, in their profile (Settings › Preferences › Keep
> findings) and for every project, where this kept it in the project's `review` settings; a
> project's `review.findingsLog` still turns it on.

## Context

ADR 0060 and 0061 decided how a design should be made: an outline, checks at each edit, a review
by the models the person picks, until they approve. None of it reached the editor: a design chat
was an agent's transcript with a mode picker and a model picker, and no review unless the agent
started one, which Claude skipped in 6 of 6 runs (gap p08). The person reviewed the chat's
redesign in four rounds of mocks and chose the names and controls below.

## Decision

1. **Names.** On screen the council is the **review models** and signing off is **approving**;
   the code and docs use the same names (`reviewModels`, `approval`), the lab's `--reviewers` and
   `--sign-off` flags staying as they are.
2. **Levels.** A **review level** names the usual review: Off (no review), Quick (the first
   review model reviews each round and approves alone), Standard (the models take turns, all
   approve: ADR 0061's defaults), Thorough (all of them every round). Any other combination, or a
   goal, is Custom (contracts' `levelOf`, `withLevel`). Standard is re-measured with step 4 of
   the review-loop plan.
3. **A review model** is an agent, one of its models and its effort (`ReviewModel`), in the order
   they take turns. None chosen, the strongest model of each agent signed in reviews.
4. **Where they are set.** Settings › Agents › Review holds the level and the review models,
   kept in the project's `ultrapaint.config.json` under `review` and shared (the findings log
   moved to the person's profile, ADR 0066);
   Custom adds Each round, Approval and Goal. The composer's **Review chip** sets this design's
   own level (`Thread.review`, over the project's field by field), a stepped slider in a popover.
   The user layer of ADR 0061 waits.
5. **The review runs itself.** When a design turn that changed pages ends, the editor's review
   loop pictures them and asks the round's review models, each a fresh agent session that can
   only look: the repository read-only, every file, terminal and permission request refused. Each
   answers with findings and approval; the score is contracts' `review`. The thread is
   `reviewing` meanwhile; Stop stops it. Unless the review ends, the findings go to the designer
   as its next prompt, marked as the review's (`review` on the user item), and it fixes each or
   declines it with its reason. Each round is a `review` item in the transcript. A model that
   doesn't answer in five minutes has no score, and the next model in turn takes the round.
6. **The model menu** holds the agent, model, effort and the permission mode (Permissions); the
   mode's icon stays in its trigger. **New chats** in Settings › Agents sets the agent, model,
   effort and permissions a chat starts with, for this project on this computer.
7. **The chat reads like an assistant at work**: the plan said once; a run card for Outline,
   Build and Review, drawn from what the transcript holds (the agent's plan, its tool calls, the
   review items), no tool added; the end says where the result is, what might be unexpected,
   what wasn't checked, and asks one question at a time. The briefing tells a design thread so.
8. A settings section that applies at once says nothing of it: its footer is Done.

## Consequences

- A design turn costs at least one more agent session per round; Off is there, marked not
  recommended.
- Reviewers see what the editor pictures and the page's document, not the repository's other
  files; a check that needs the code waits for the checks at each edit (ADR 0061).
- The run card's Outline step shows only when the agent writes one, until the skill's outline
  step ships (review-loop plan, phase 4).

## Amended: the lighter review (2026-11-06)

In the lab (`~/Code/ultrapaint-data/runs/chat-compare/summary.md`), Codex designed three screens
without review and with Standard as first built (Opus and GPT-6.1-Sol in turn, fresh looks, six
rounds at most). With review, a panel of fresh reviewers (GPT-6.1-Sol and Grok 4.7) still found
36.3 problems a screen against 33.3 without, at 7× the time and 6× the tokens; no review ended
approved, each fresh look finding 2–4 new majors once the last were fixed. The person chose a
lighter review:

- Only blockers and majors go to the designer; minor findings and nits stay in the round, for the
  person to see. A review model with none to send approves.
- Round 1 is a first look by the round's model (in turn). Round 2 is a second look, by every review
  model when all are to approve, else by the first look's: told what the designer was sent, it
  gives back only what isn't fixed and any new blocker.
- Two rounds at most (contracts' `MAX_ROUNDS`). At the cap, blockers and majors left are sent once
  more and the review ends there.
- A finding the states of one screen share is given once, naming its pages.

The levels keep their names: Quick (the first model looks, then checks the fixes), Standard (one
model looks, in turn; then all check the fixes), Thorough (all look, then all check).
