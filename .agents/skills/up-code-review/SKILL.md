---
name: up-code-review
description: Reviews code on two axes, Standards and — when given a spec — Spec. Use before opening a PR, or when asked to review a branch, a commit range, working changes or a few files.
metadata:
  pack: epicparty/skills
  version: 0.1.0
---

# Code Review

Two-axis review of a piece of code:

- **Standards** — does the code conform to the project's documented standards? Always runs.
- **Spec** — does the code faithfully deliver what it was meant to? Runs when a **spec** is passed in.

Both axes run as **parallel sub-agents**, so neither pollutes the other's context, then this skill aggregates their findings.

**Invoking this skill is the user asking for them**, so spawn them without a separate ask. The isolation is the point: an axis that has read the other's findings anchors on them. Running both inline is a fallback to report as one, never the default.

## 1. Pin the code

Take the first that fits:

- **Files the user named** — read whole; there is no diff and no commit list.
- **A commit, tag, or range the user named** — `git diff <ref>...HEAD`.
- **Uncommitted changes**, when the user asked for working changes or the branch has no commits of its own — `git diff HEAD`.
- **The branch** — the default: the merge-base with the default branch, `git merge-base HEAD origin/<default>`, the default from `git symbolic-ref refs/remotes/origin/HEAD`, or `gh repo view --json defaultBranchRef` where that is unset. This is what a branch review means and what `/up-implement` and `/up-babysit` ask for.

Capture a diff once — three-dot, so the comparison is against the merge-base and not against whatever else has landed since — and note its commits with `git log <fixed-point>..HEAD --oneline`. Confirm the ref resolves (`git rev-parse`) and the diff is non-empty before going further. A bad ref should fail here, not inside two sub-agents.

Done when you have the code to review — a non-empty diff with its commits, or the named files.

## 2. Take the spec

The **spec** is whatever the caller or the user passed to say what the code should do: an issue, a PR, a file, or plain text. This skill never searches for one.

- **An issue** — fetch it with its comments (`gh issue view <n> --comments` on GitHub). The comments matter as much as the body — they carry decisions that never got written up.
- **A PR, a file or text** — read it as given.
- **Nothing** — the review is Standards only. Say so in one line of the report — *Spec skipped: no spec given; name one to check it* — and ask nothing.

Done when you hold the spec, or know the review is Standards only.

## 3. Gather the standards sources

The project documents its rules in its agent files and the documents they route to. Collect the ones that actually govern the diff rather than passing all of them:

- **`AGENTS.md` or `CLAUDE.md`, root to leaf** — the root file, then the nearest one to each changed path. The nested ones override for their subtree.
- **The routed standards** — every document those files route the touched paths to, followed to the specific file for the touched code.
- **The commit rules** — subjects and scopes, wherever the project states them. Under a rebase merge every commit reaches the default branch as itself, so each one is reviewed.
- **The domain glossary and its ADRs** — where `/up`'s [`DECISIONS.md`](../up/DECISIONS.md) says the project keeps them. The diff should speak the domain's words, and a rename of an established term is a finding.

**Skip what tooling already enforces.** The formatter, linter and typechecker the project's scripts run already gate their rules. A review finding about a rule the gate would have caught spends the reviewer's attention on something a command already answers.

The Standards axis also carries the **smell baseline** — the flat reference at the foot of this file. Step 4 pastes it into the sub-agent verbatim, so have it to hand.

Done when you have the `AGENTS.md` chain, the routed standards for every touched path, and the baseline ready to paste.

## 4. Spawn both sub-agents in parallel

**Standards sub-agent** — give it the diff command, the commit list, the standards files from step 3 by path, and the smell baseline **pasted in full**, since it has no other access to it. The brief:

> Report, per file or hunk: (a) every place the diff violates a documented standard — cite the standard by file and rule; (b) any baseline smell — name it and quote the hunk. Mark documented-standard breaches as hard findings and baseline smells as judgement calls. A documented project standard overrides the baseline. Skip anything the formatter, linter or typechecker enforces. Under 400 words.

**Spec sub-agent** — give it the diff command or the files, the commit list, and the spec — for an issue, its body **and comments**. The brief:

> Report: (a) requirements the spec asks for that are missing or partial — check every numbered user story and every acceptance criterion; (b) behaviour in the code the spec never asked for, which is scope creep; (c) requirements that look implemented but look wrong. Quote the spec line for each finding. Under 400 words.

Skip the Spec sub-agent when step 2 holds no spec.

Done when both sub-agents have returned, or the Spec axis is recorded as skipped with its reason.

## 5. Aggregate

Present the two reports under `## Standards` and `## Spec`, verbatim or lightly cleaned. Keep them separate — **merging or reranking them across axes is what this structure exists to prevent**.

End with one line: the finding count per axis, and the worst finding *within each axis*. Do not pick a single winner across the two.

A **Spec finding that names a missing requirement means the feature is not done.** It goes back to `/up-implement`, not into a PR thread.

Done when both axes are reported and every finding is attributable to a standard or a spec line.

## The smell baseline

Fowler's code smells (_Refactoring_, ch.3). They apply even where the project documents nothing, and two rules bind them:

- **The project overrides.** A documented standard always wins; where it endorses something the baseline would flag, suppress the smell.
- **Always a judgement call.** Each smell is a labelled heuristic ("possible Feature Envy"), never a hard violation.

Each smell reads *what it is* → *how to fix*; match it against the diff:

- **Mysterious Name** — a function, variable, or type whose name doesn't reveal what it does or holds. → rename it; if no honest name comes, the design's murky.
- **Duplicated Code** — the same logic shape appears in more than one hunk or file in the change. → extract the shared shape, call it from both.
- **Feature Envy** — a method that reaches into another object's data more than its own. → move the method onto the data it envies.
- **Data Clumps** — the same few fields or params keep travelling together (a type wanting to be born). → bundle them into one type, pass that.
- **Primitive Obsession** — a primitive or string standing in for a domain concept that deserves its own type. → give the concept its own small type.
- **Repeated Switches** — the same `switch`/`if`-cascade on the same type recurs across the change. → replace with polymorphism, or one map both sites share.
- **Shotgun Surgery** — one logical change forces scattered edits across many files in the diff. → gather what changes together into one module.
- **Divergent Change** — one file or module is edited for several unrelated reasons. → split so each module changes for one reason.
- **Speculative Generality** — abstraction, parameters, or hooks added for needs the spec doesn't have. → delete it; inline back until a real need shows.
- **Message Chains** — long `a.b().c().d()` navigation the caller shouldn't depend on. → hide the walk behind one method on the first object.
- **Middle Man** — a class or function that mostly just delegates onward. → cut it, call the real target direct.
- **Refused Bequest** — a subclass or implementer that ignores or overrides most of what it inherits. → drop the inheritance, use composition.

## Why two axes

A change can pass one and fail the other:

- Follows every standard, implements the wrong thing → **Standards pass, Spec fail.**
- Does exactly what the issue asked, breaks the project's conventions → **Spec pass, Standards fail.**

Reporting them separately stops either from masking the other.
