# ADR 0151: A review round waits for the answers

Status: accepted, 2026-11-26. Amends 0063 §5 (the review runs itself when a design turn ends) and
§7 (the chat asks one question at a time). Follows 0074, 0098, 0102, 0125 and 0129. Story:
UP-213.

## Context

A question the designing agent left for the designer was buried by the review round that starts
as soon as the turn ends. It came two ways. The briefing asked the agent to "ask one question at
a time" without saying where, so an agent ended its reply on a question the editor could not see.
And an agent that cannot wait on a form gets its `ask_user` questions as a card and ends its turn
(ADR 0125); the round started at that turn's end all the same, and its findings arrived as the
agent's next prompt before the designer's answers. In two weeks of two client projects' logs, the
person asked for "the missing questions" 15 times in 6 threads.

## Decision

- **A decision for the designer goes on a card.** The design chat's briefing (`designChat`) says
  a decision left for the user goes to the question tool before the turn ends, one question
  each, its options with the suggestion first, and that the last message asks nothing. The tool
  is named through the agent's ways: `ask_user` with the editor's tools, the agent's own question
  tool without them. A question in the agent's prose is not detected: guessing at words is
  fragile, and the briefing removes the cause.
- **A round waits while the turn's question waits.** A question **waits for the answers** when
  it is neither answered, declined nor withdrawn (contracts' `isOpenQuestion`, the predicate the
  threads list's `summarise` reads too), and it holds the round when it was asked since the
  last prompt, the person's, a round's findings or a steer into the turn, and the turn has ended
  (`waitsForAnswers`). The review loop's `due` then starts no round, as after a turn of
  variations (ADR 0098), and the pages the turn changed stay waiting. The items are the record:
  they survive a restart, and one predicate serves the list and the loop.
- **The next turn's end is the next chance.** Answered, the card's answers are the next prompt;
  that turn's end starts the round, which looks at both turns' pages. A card from an earlier turn
  holds nothing once the person has sent another prompt, typed, a queued one sent now, or a
  steer into the turn under way (ADR 0137): that turn's end starts the round with both turns' pages, so a card left unanswered never
  holds the review for the rest of the thread.
- **Nothing starts a held round but a turn's end.** Not the time passing, and not a card's state:
  a round started when the designer answers or dismisses a card would prompt an agent on a state
  the editor notices (ADR 0074). A card no agent waits on has no decline (ADR 0125), and one an
  agent waits on within its turn is answered, declined or withdrawn before the turn ends, so a
  turn that waits on its questions in the turn is reviewed as before.
- **The run card says so.** While a question of the run's last turn waits, the run card's Review
  step reads "Waits for your answers" (`reviewStep`, `waitingRun` in web's `design-run.ts`), and
  the turn card shows the run's steps then, as it does for a run the person stopped; a thread whose turns are
  not reviewed (contracts' `isReviewed`, the review loop's own test) shows nothing waiting. One
  line in
  the existing step, no new control (ADR 0102: the run card's job is where the run stands).

## Consequences

- An agent that ends its turn on a card sees no findings until the designer has answered, and
  the findings it then gets judge the design the answers decided.
- A designer who never answers and never prompts again leaves the turn unreviewed. The pages are
  still owed a round: the next prompt's turn reviews them.
- What a question in the prose asks stays unseen when an agent ignores the briefing; the logs
  are where that shows.
