# ADR 0157: The person decides a decline the page shows

Status: accepted, 2026-11-27. Amends [0063](0063-the-design-chat-runs-the-method.md) §5 and
[0081](0081-checks-are-findings-for-the-designer.md) §4 (the designing agent declines a finding
alone, with its reason). Follows 0022 and 0125 (a question waits within the turn), 0129 (the
turn's questions fold into its card), 0140 (every question takes typing), 0151 (a round waits for
the answers) and 0066 (the findings log). Keeps 0074. Story: UP-212.

## Context

When the review models' findings came in, the designing agent decided alone which to decline. The
person learned of it afterwards, from the `Declined:` lines at the end of its reply, and could
overrule one only by typing a new prompt. In two weeks of two client projects' logs, agents
declined 28 major findings of the review models in 13 of 35 design threads, and none was put to
the person. On one day the person typed "ask me again the declined questions", or a prompt like
it, 15 times in 6 threads. Asked at last, they overturned the agent's decline 7 times in 16.

## Decision

1. **The person decides a decline the page would show.** A review model's finding the designer
   would decline, where declining it leaves on the page what the finding says is wrong, is put to
   the person on the question tool before the reply ends: one question per finding, the worst
   first and at most four a call (`ask_user`'s limit), the agent's call first ("Keep it as it is:
   <reason>"), then the fix. The agent fixes what they choose to fix, or does what they typed
   instead (0140). It declines without asking only what changes nothing the person sees: a
   finding the design already meets, or one about something the request ruled out in its own
   words.
2. **Where it is told.** The round's findings prompt (`findingsPrompt`) and the design chat's
   briefing (`reviewAnswered`, which was the `REVIEW_ANSWERED` text) both carry the rule, the
   question tool named as the agent knows it: `ask_user` with the editor's tools, its own question
   tool without them (`AgentWays.questionTool`, which the briefing's question line reads too). The
   review loop is told which way the thread's agent has when the round starts (`run`'s `tools`).
3. **The agent says who decided.** It ends its reply with `Declined: <number> — <reason>` for its
   own call and `Declined by the user: <number> — <reason>` for a decline the person kept when
   asked. `declinedOf` reads both ("by the person" too, never "by the designer", which is the
   agent in the editor's words) and gives each decline its reason and who decided, a check's
   always the agent's; the round's finding keeps `decidedBy: "person"`, absent for
   the agent's (contracts' `DecidedBy`), as every decline stored before, and so does its line in
   the findings log (`LoggedFinding.designer.decidedBy`), so triage tells the two apart. Matching
   the turn's question items to findings by their words was rejected as guessing: the agent is the
   one party that knows which question answered which finding.
4. **An unanswered question leaves the agent's call.** A question the person declines, or one the
   agent cannot wait on (its card is answered by the next prompt), is written as `Declined:`, and
   the reply says the person hasn't answered. UP-213's hold (0151) keeps the next round until the
   turn the answers begin has ended, and that round judges the design they produced; the earlier
   round's record is not rewritten. A turn the person stops answers nothing, as before: the agent
   writes no lines after a stop, nothing is fixed, and the round keeps no answer.
5. **A check's finding is never asked.** It is minor (0081), declined most often (188 in the
   logs) and upheld when the person was asked of the most-declined kind; `ask_user` has no
   multi-select, and adding one would spend the MCP tool budget. The agent still declines a
   check's finding alone, and the card lists it as a declined check, as before.
6. **The card says who decided.** A review model's declined finding reads "Declined by the agent"
   or "Declined by you", with the reason. One line in the round's existing list (ADR 0102: the run
   card's job is where the run stands); no control to answer a decline later.

## Consequences

- A design choice the person cares about is not settled without them, and agreeing with the agent
  is one click.
- A findings reply may hold the turn on questions; with a waiting agent the review continues once
  they are answered, with one that cannot wait, after the answers' turn.
- What a reply says of who decided is the agent's word: one that ignores the rule declines alone,
  and its lines read as the agent's.
