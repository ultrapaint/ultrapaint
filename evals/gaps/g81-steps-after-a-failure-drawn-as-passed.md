---
id: g81
title: Steps after a failure drawn as passed
kind: missing
status: done
found: 2026-11-18
source: the lab's fresh-place-deploy brief (a deployment whose build failed at typecheck), rounds of 17 and 18 November
skill: [SKILL.md, references/states.md]
sections: []
---

**What happened.** The brief gives a build's four steps with their times (install 38 s, typecheck
22 s, build 1 min 34 s, upload 7 s) and says the build failed at typecheck. Designs drew build and
upload after the failure with green ticks and their times, and one said "3 of 3 checks passed" on
the failed build. A developer reading the failure would take the build as having gone further
than it did. The others marked the two steps "Not run".

| Skill | Rounds | Failed deploys with later steps passing |
| --- | --- | --- |
| Without the rules of PR #56 (shipped before it, placement-2) | `pf-opus`, `pf-opus-p2` (17 Nov), `pf-opus-old18` (18 Nov) | 0 of 6 |
| With them (placement-3, show-less-1, the skill on main) | `pf-opus-p3`, `pf-opus-sl1`, `pf-opus-main` (18 Nov) | 5 of 6 |

Fisher's exact test, one-sided: p ≈ 0.008. The old skill made on 18 November marks both runs "Not
run", so the fault goes with the rules rather than with the day, though two same-day runs and six
runs a side cannot rule out run-to-run variation. Which line brings it is not known: none of them
speaks of steps; what placement-3, show-less-1 and main share and placement-2 lacks is the header
cap and the finished state's most used action.

**The skill now.** Nothing on a sequence whose step failed: `states.md` covers a screen's states
(empty, loading, error), not the steps of one run.

**Proposed.** In `SKILL.md`, States: "In a run of steps, those after a failed one are not run:
no tick, no time, marked as skipped."

Scope: a pipeline can run steps in parallel or go on after a failure. The line as measured says
"the steps after a failed one"; one that ships would name the steps that wait on it ("the steps
that depend on a failed one did not run"), which reads the same on a sequential build like this
brief's, and is checked on such a brief before it lands.

**Test.** `fresh-place-deploy`, 2 runs each, Opus designing, the skill on main against main with
the line: the failed screen's later steps, read from each run's picture and source.

**Result.**
- `pf-opus-steps`, `pf-opus-main`: 2026-11-18, `fresh-place-deploy`, 4 runs each, Opus in Claude Code designing, read from each run's picture and source: `candidates/steps-1` (main with the line of **Proposed**, unscoped) draws the failed build's later steps as not run in 4 of 4; the skill on main draws them as passed in 1 of 4 (run 1, seen before; runs 2 to 4 mark them not run). With the 18 Nov runs of placement-3 (2 of 2) and show-less-1 (2 of 2), the rules of #56 come with the fault in 5 of 8 runs, against 0 of 6 without them (Fisher one-sided p ≈ 0.03); the skill as shipped, 1 of 4. Read: the line clears it on this brief at the cost of one line; whether to ship it, scoped to the steps that depend on the failed one, is asked in `decisions/gaps-nov18`.
- `gaps-nov18`, decided (the person, 2026-11-19): ship the line, scoped to the steps that depend on the failed one. Shipped in `SKILL.md`, States: "In a run of steps (a build, an import, a checkout), the steps that depend on a failed one did not run: no tick, no time, marked as not run." The scoped wording has not yet had its own run on `fresh-place-deploy`, as **Scope** asks; the gap stays `testing` until two runs of the skill with it are recorded here.
- `pf-opus-main19`: 2026-11-19, `fresh-place-deploy`, 2 runs, Opus in Claude Code designing with
  the skill on main (the scoped line), read from each run's picture (`shots/desktop-01.jpg`) and
  source: both draw the failed build's Build and Upload with an empty circle and "Not run", no
  tick, no time. Run 2 keeps the brief's "Checks: 3 of 3 passed"
  under the failed screen's Details; run 1 shows "Not run" there. The brief gives that fact once
  for the deployment, so it is not a step drawn after the failure. Done.
