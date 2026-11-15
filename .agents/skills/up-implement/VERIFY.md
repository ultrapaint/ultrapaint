# Measuring a target

<!-- upstream: backnotprop/pstack skills/poteto-mode/playbooks/hillclimb.md -->
<!-- upstream: backnotprop/pstack skills/benchmark-checklist/SKILL.md -->

How [`/up-implement` § 7](./SKILL.md#7-prove-it) proves a story whose outcome is a number — a response time, a bundle size, memory, a query count, an accuracy score — and how [`/up-diagnose`](../up-diagnose/SKILL.md) reads a slowdown's timings. The story's `## Testing Decisions` names it in a **Measure** line: the target, the command that measures it, and its inputs.

The work is a **hill climb**: measure, make one change, measure again, keep the change only when the number moved by more than its noise. Every rule below exists because a number is easy to fool, and an agent climbing it is the likeliest to fool it.

## The harness is frozen

Before the first change, fix four things, and hold them for the whole climb:

- **The measure** — the command, run the same way every time, on this machine.
- **The inputs** — the fixtures or data it runs on.
- **The target** — the number the story set.
- **The freeze line** — what must stay green while the number moves: the story's tests and the **Scoped check**.

A climb that changes any of them starts again from a new baseline. A target or a measure that turns out wrong is an **open question** for the user, raised before the climb goes on.

## Baseline and noise floor

Run the measure on `origin/<default>` and on the branch, **alternating** the two, at least five times each. Report each side's **median** and **range**.

The **noise floor** is the spread of one side's own runs: two medians closer than it are the same number. When the noise floor is as wide as the gap to the target, make the measure quieter before climbing — more runs, a longer timed region, an idle machine — and say so; climbing inside the noise only records luck.

Done when both sides have a median and a range, and the noise floor is narrower than the gap you are trying to close.

## The climb

1. **One change per round.** Two changes in one round leave the gain with no cause.
2. **Measure it the same way**, alternating against the last kept state.
3. **Keep it** when the median beats the last kept one by more than the noise floor and the freeze line is green. Otherwise revert it.
4. **Commit each kept win** on its own, with the before and after medians in its body.

**Stop** when the target is met and a fresh set of runs confirms it: one lucky round ends nothing. Stop as well after three rounds in a row with no kept change. Then sort what is left by cause, report it, and leave going further to the user.

Done when the target is met and confirmed, or the climb stopped with its rounds reported.

## Explain the number

A win is reported only once you can say why it is that size:

- **What limits it now?** Name the bottleneck the next win would hit. A number with no limit you can name is not understood yet.
- **Did the work happen?** Inside the timed region, the full work ran: no cache hit the real path would miss, no skipped step, no error path that returns early.
- **Was the comparison fair?** Both sides ran the same build mode, config and data, and neither was warmed when the other was not.
- **Does it matter end to end?** The number the person or the system meets moved, not only a micro-benchmark beside it.

A number that fails any of these is **inconclusive**: report it as that, with what you know, never as the win.

## Report

One table in the hand-off and the PR body: the measure, the machine, and per side the runs, the median and the range — the baseline, every kept round, and the final state — then the target, and whether it was met.
