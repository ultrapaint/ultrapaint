---
id: g81
title: Steps after a failure drawn as passed
kind: missing
status: open
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
run", so the fault follows the rules, not the day. Which line brings it is not known: none of them
speaks of steps; what placement-3, show-less-1 and main share and placement-2 lacks is the header
cap and the finished state's most used action.

**The skill now.** Nothing on a sequence whose step failed: `states.md` covers a screen's states
(empty, loading, error), not the steps of one run.

**Proposed.** In `SKILL.md`, States: "In a run of steps, those after a failed one are not run:
no tick, no time, marked as skipped."

**Test.** `fresh-place-deploy`, 2 runs each, Opus designing, the skill on main against main with
the line: the failed screen's later steps, read from each run's picture and source.

**Result.**
