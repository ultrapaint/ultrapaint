---
name: up-diagnose
description: Diagnoses a failure in this codebase — a bug, an error, a failing or flaky test, a slowdown — with a loop that goes red on it before any theory, then fixes it under a regression test. Use when something is broken, failing or slow, or the user asks to debug or investigate why.
metadata:
  pack: epicparty/skills
  version: 0.1.0
---

# Diagnose

<!-- upstream: mattpocock/skills skills/engineering/diagnosing-bugs/SKILL.md -->

A discipline for hard bugs. Skip a phase only with a stated reason.

Where the failure has an issue — named by the user, or found by searching the tracker with the symptom's own nouns, the way `/up` § 1 searches — read it with its comments — the tracker is the **Tracker** setting when set, or GitHub when `gh repo view` finds the repo — and claim it the way [`/up-implement` § 1](../up-implement/SKILL.md#1-load-the-story) does. Read the glossary and the ADRs in the area, where `/up`'s [`DECISIONS.md`](../up/DECISIONS.md) says they live, for a clear model of the modules involved.

**Redact every secret** in what you show — commands, outputs, captured artifacts: write `<REDACTED>` in its place. Build loops against environment variables, so the credential stays in the environment. Captured artifacts carry auth headers: quote only the lines that carry the signal. If the redacted output is not enough to diagnose, say so and ask the user.

## 1. Build a feedback loop

**This is the skill.** With a **tight** pass/fail signal that goes **red** on _this_ bug, you will find the cause — bisection, hypotheses and instrumentation all just consume it. Without one, no amount of reading code will save you. Spend disproportionate effort here, and refuse to give up.

Ways to build one, roughly in this order:

1. **A failing test** at whatever seam reaches the bug — unit, integration, end-to-end.
2. **A curl or HTTP script** against a running dev server.
3. **A CLI run** with a fixture input, diffing its output against a known-good snapshot.
4. **A headless browser script** that drives the UI and asserts on the DOM, the console or the network.
5. **A replayed trace** — a real request, payload or event log saved to disk and replayed through the code path alone.
6. **A throwaway harness** — the smallest subset of the system that reaches the bug's path in one call.
7. **A property or fuzz loop** — for "sometimes wrong", a thousand random inputs, looking for the failure.
8. **A bisection harness** — when the bug appeared between two known states, automate "boot at state X, check" and `git bisect run` it.
9. **A differential loop** — the same input through the old and the new version, or two configs, with the outputs diffed.
10. **A human in the loop**, last — when a person must click, drive _them_ with [`scripts/hitl-loop.template.sh`](./scripts/hitl-loop.template.sh), so the loop stays structured and its captured output feeds back to you.

**A slowdown's loop is a measurement** — a timing harness, a profiler, a query plan — against a threshold the user agrees: red is slower than it. A regression with a known fast state bisects to it (8); a slowness with none is a profiling job, and the threshold is still its red.

Then **tighten** it, treating the loop as a product: faster (cache setup, skip unrelated start-up, narrow the test scope), sharper (assert the specific symptom, not "did not crash"), more deterministic (pin time, seed randomness, isolate the file system, freeze the network). A thirty-second flaky loop is barely better than none.

**A non-deterministic bug** needs a higher reproduction rate, not a clean repro: loop the trigger a hundred times, parallelise, add stress, narrow timing windows. A 50 % flake is debuggable; 1 % is not, so keep raising the rate.

**A loop blocked only by a permission or a missing install** is not "no loop": ask for the approval or the install, and wait.

**No loop possible?** Stop and say so, with what you tried. Ask the user for access to an environment that reproduces it, a redacted captured artifact (a HAR file, a log dump, a screen recording with timestamps), or permission for temporary production instrumentation. Do not hypothesise without a loop.

Done when you can name **one command** — a script, a test invocation, a curl — that you have already run at least once, with its redacted invocation and output shown, and that is:

- [ ] **Red-capable** — it drives the bug's actual code path and asserts the **user's exact symptom**, so it goes red on this bug and green once fixed.
- [ ] **Deterministic** — the same verdict every run, or a pinned high reproduction rate for a flaky bug.
- [ ] **Fast** — seconds, not minutes.
- [ ] **Agent-runnable** — it runs unattended, with a human only through the HITL script.

Reading code and config to build the loop is the work of this step; reading it to build a theory before that command exists is the exact failure this skill prevents. No red loop, no § 2.

## 2. Reproduce and minimise

Run the loop and watch it go red. Confirm it shows the failure the **user** described — a nearby failure is the wrong bug, and gets the wrong fix — that it reproduces across runs, and that you hold the exact symptom (the error, the wrong output, the timing) to check the fix against.

Then shrink it to the **smallest scenario that still goes red**: cut inputs, callers, config, data and steps one at a time, re-running after each cut. A minimal repro shrinks the hypothesis space and becomes the clean regression test.

Done when every remaining element is load-bearing — removing any one turns the loop green.

## 3. Hypothesise

Write **three to five ranked hypotheses** before testing any: one hypothesis anchors on the first plausible idea. Each states the prediction that would falsify it — "If X is the cause, changing Y makes the bug disappear, and changing Z makes it worse." A hypothesis with no prediction is a vibe: sharpen it or drop it.

Show the ranked list to the user before testing. They often re-rank it at once ("we just deployed a change to 3"), or have ruled some out already. When they are not there, proceed on your ranking.

Done when the list is ranked, each item carries its prediction, and the user has seen it or is away.

## 4. Instrument

Each probe maps to one prediction from § 3. Change one variable at a time.

Prefer a debugger or REPL where the environment has one — one breakpoint beats ten logs — then targeted logs at the boundaries that tell hypotheses apart. **Tag every debug log** with a unique prefix, such as `[DEBUG-a4f2]`, so the cleanup is one search.

**A slowdown** takes measurement, not logs: probe with the § 1 measurement, one change at a time.

Done when one hypothesis survives with the evidence that killed the others.

## 5. Fix under a regression test

Cut a branch for the fix as [`/up-implement` § 2](../up-implement/SKILL.md#2-cut-the-branch) does — with no issue, a plain `git switch -c <branch>` off the default branch — unless you are already on the work's branch.

Write the regression test **before the fix**, at a **correct seam**: one where the test exercises the real bug pattern as it happens at the call site. [`TDD.md`](../up-implement/TDD.md) says what a good test is, and [`SEAMS.md`](../up-to-story/SEAMS.md) gives the seam vocabulary. The correct seam is the agreement here: a regression test needs no story to name it. A seam too shallow to replicate the chain that caused the bug — one caller where the bug needs two, a unit test that cannot reach it — gives false confidence. **No correct seam is itself the finding**: the code's shape keeps the bug from being locked down, and that goes under **Found in passing** (`/up` `## Vocabulary`), where [`/up-architect`](../up-architect/SKILL.md) can take it up.

A slowdown's regression test is a budget the suite can hold — a measured timeout or a benchmark threshold, by the project's own rules for slow tests. Where none fits, the threshold and its measurement go in the PR body.

With a correct seam:

1. Turn the minimised repro into a failing test there.
2. Watch it fail. Where you forced the red by changing code or a fixture, diff against a clean copy to prove the change landed before you trust it.
3. Apply the fix.
4. Watch it pass.
5. Re-run the § 1 loop against the original, unminimised scenario.

Then validate with `/up-implement`'s **Scoped check** where it is set, or the project's own typecheck and test scripts, the way [its § 6](../up-implement/SKILL.md#6-validate) does, and review the diff as its § 7 does.

Done when the test is green, the original loop is green, and the check passes.

## 6. Clean up and hand off

- [ ] The original repro no longer reproduces.
- [ ] The regression test passes, or the missing seam is written down.
- [ ] No `[DEBUG-…]` line is left — search for the prefix.
- [ ] Throwaway harnesses are deleted, or moved to a clearly marked debug location.

Commit per `/up`'s [`GIT.md`](../up/GIT.md) `## Commits`, and state the hypothesis that proved correct in the commit body, so the next debugger learns from it. Then [`/up-to-pr`](../up-to-pr/SKILL.md) opens the pull request.

Report the symptom, the loop, the hypothesis that held and the ones ruled out, the fix, and every finding and **open question** you are leaving.

## Settings

This skill asks for nothing. It reads, when they are set, the settings `/up-implement` reads for the branch, the tests and the check — **Tracker**, **Checkout**, **Labels** and **Scopes** from `/up` `## Settings`, **Test levels**, and `/up-implement`'s **Scoped check**. Without them it uses GitHub where `gh repo view` finds the repo, and the project's own typecheck and test scripts.
