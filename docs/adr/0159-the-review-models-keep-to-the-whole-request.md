# ADR 0159: The review models keep to the thread's whole request

Status: accepted, 2026-11-27. Amends [0063](0063-the-design-chat-runs-the-method.md) §5 (what a
review model is asked). Follows 0111 (the review judges within the request). Story: UP-214.

## Context

A review model judges a design within the person's request (0111, the skill's
`references/review.md`). The request it was given was the person's last prompt alone (`runOf`'s
`request`, written under "What the person asked" by `reviewerPrompt`). A thread is a
conversation: the brief, then prompts that narrow it ("focus only on the layout, leave the content
empty"), then short ones that ask for nothing new ("ask me again the declined questions") and the
answers to a card no agent waited on, which arrive as a prompt of their own ("Answers to your
questions:"). When the last prompt was one of those, the reviewers lost every earlier decision. In
two client projects' logs over two weeks, 11 of 54 review runs, in 5 threads, were briefed with an
"ask me …" prompt as the whole request; one raised "main column is empty" as a major on a thread
whose person had asked for the layout only, and the agent had to decline it citing their words.

## Decision

1. **The request is what the person said since the brief** (`requestOf` in `review-rounds.ts`,
   `RequestPrompt`): their prompts and their answers to the designer's questions, oldest first,
   the newest prompt what the turn was asked. The **brief** is the last prompt that is a task the
   editor knows (`parseCommand` reads it as a request: `/redraw`, `/import-figma`, …), else the
   thread's first prompt, so a thread taken to new work leaves the old brief behind. `/variations`
   starts none: it takes a thing of the same design a few ways, its turn is never reviewed
   (0098), and the turn after it, choosing a take, keeps to what was asked before (the person's
   call on the PR).
   A prompt carrying a round's findings (`review` on the user item) is the editor's and stays out.
   Answers come two ways, and both are kept: a prompt of their own when no agent waited on the
   card (it starts with elicitation's `ANSWERS_HEADING`, a line the editor writes, so reading it
   is not guessing at the person's words), and a question item the designer waited on within its
   turn (contracts' `answeredInTurn`, `inTurn` on the request), written as `answersText` writes
   the first. A card still open, declined or withdrawn says nothing.
2. **No prompt is left out by its words.** Skipping prompts that only ask for questions or
   answers was rejected: with the earlier prompts there, such a prompt marked as the newest
   misleads nothing, and a filter on words would one day drop a real request (0157 rejects
   guessing at an agent's words for the same reason).
3. **How it is told.** A thread of one prompt reads as it always did: the prompt alone in
   `<request>`. Otherwise each prompt is a `<prompt>` and each set of answers an `<answers>`, in
   order, the newest prompt `turn="this"`, after one line: a later prompt changes an earlier one
   where the two differ, and the rest of the earlier ones still hold.
4. **The cap** (`shownRequest`, `REQUEST_CAP` and `EARLIER_PROMPT_CAP` beside `REVIEW_TIMEOUT`):
   the newest prompt in full, everything else cut to its first 400 characters, the oldest left
   out first once what is shown passes 4,000 characters, and a line counting them. A page's document
   is larger than the block, and the newest is never cut because it is what the turn asked.
5. **Where a run starts is unchanged**: its rounds and the round it answers (`runOf`'s `rounds`
   and `answering`) still start at the person's last prompt. Only what the reviewers are told
   grows. The lab's reviewers review one section with its own brief and are unchanged.

## Consequences

- A constraint the person gave early (layout only, no design system, keep the copy) holds for
  every later round of the thread, and the designer is not made to defend it through declines,
  as long as the cap keeps it: one written past an earlier prompt's first 400 characters, or in a
  prompt left out past 4,000, is not shown to the reviewers.
- A reviewer reads up to 4,000 more characters; the newest prompt alone can pass that, as it
  could before.
- A task started in an old thread drops everything before it from the request, by design; a
  thread reused for new work by a typed prompt keeps the old brief, and its newest prompt, marked
  as this turn's, is what the reviewers follow where the two differ.
