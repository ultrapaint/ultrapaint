# ADR 0066: Findings are kept by the person, and triaged into gaps

Status: accepted, 2026-11-06. Amends 0063 (the findings log kept in the project's configuration)
and carries out 0060's triage (issue #8).

## Context

ADR 0060 made the findings log opt-in and left its triage to later; 0063 put its switch in the
project's `review` settings, which `ultrapaint.config.json` shares with a team. Two days on, no log
existed on the machine that does the most designing: nothing had turned it on, and nothing read it.
Every correction the review models made was fixed and forgotten, and a gap was written only when
someone thought to write one. ADR 0065 sends every rule that holds for any product to a gap, so a
rule now waits in its gap until the lab measures it: that wait is only acceptable if what reviews
find reaches the gaps on its own.

## Decision

- **Keeping findings is the person's choice**, in their profile (`~/.ultrapaint/profile.json`,
  `keepFindings`), shown as **Keep findings** in Settings › Preferences, where what applies in
  every project lives. The log is in their own directory and holds every project's findings, so a
  project's configuration no longer decides it; a project's `review.findingsLog` still turns it on.
- **Triage** (`pnpm evals triage`) reads the logs and drafts gaps:
  1. it groups the findings that describe the same problem, across designs, projects and models;
  2. it keeps a group that recurs (in several designs, or found by several review models) and
     counts a designer's reasoned decline against it;
  3. review models on two providers read each group with the skill and say whether it is real and
     holds beyond its design, whether the skill has a rule for it (`missed`) or not (`missing`),
     and whether a gap already covers it;
  4. what survives is drafted as gap files (`status: open`, the findings as their evidence, the
     crops in the data directory's `gaps/<id>/`) and a group an existing gap covers adds to that
     gap's evidence;
  5. the person keeps or drops each draft in a decision deck before any recall round spends quota.

## Consequences

- Findings and their crops stay outside git; a drafted gap quotes only the findings' words and
  names the projects, and the person decides in the deck whether a gap from a private project is
  kept.
- The thresholds (how many designs, how many models) are flags with defaults, to be set again once
  there is enough log to judge them by.
