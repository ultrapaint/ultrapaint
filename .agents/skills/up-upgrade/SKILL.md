---
name: up-upgrade
description: Upgrade a pnpm workspace's dependencies to the versions /up-outdated reports, migrate the code to their changelogs, and run the full gate.
disable-model-invocation: true
metadata:
  pack: epicparty/skills
  version: 0.1.0
---

# Upgrade

An [`/up-outdated`](../up-outdated/SKILL.md) report in, an upgraded workspace out: every target installed, the code migrated to each changelog, each improvement adopted, and the project's **Full gate** green.

It is user-invoked because it rewrites pins across the whole workspace. That should start only when someone asks for it.

## 1. Get the report

A report lives only in the thread that wrote it. Look back through this thread for an `/up-outdated` report, and reuse it when all of these hold:

- It covers every package in this upgrade's scope.
- Its quarantine is the one the user wants now.
- `pnpm-workspace.yaml` and the manifests have not changed since it was written.

A report that covers part of the scope gets `/up-outdated` for the rest only. Any other case gets a new `/up-outdated` for the whole scope. A cut the user makes in the report — "leave Sentry out" — narrows the scope.

Done when one report covers the whole scope, and you can say whether you reused it or wrote it now.

## 2. Agree the involvement and the record

The **involvement** is how much of the upgrade the user wants to decide. Ask for it with one question, unless the thread already says:

- **Auto** — you decide every **open question** and run straight through. Decide each one for the project's best interest, from what the project already says: the standards, the ADRs, the code and the report. The report lists each decision with its reason.
- **One pass** — every open question goes to the user before the first write. Then the upgrade runs straight through.
- **Chunks** — the user picks each **chunk**, a few families at a time. The chunk's open questions go to them first. The chunk is upgraded and gated, and the user picks the next one.

The **open questions** are the report's own section. A user who chose to decide needs the full context for each one, so ask them **one at a time**, as a **briefing**:

- **What changed** — the release and the change, in plain words.
- **Why** — the reason upstream gives for it.
- **What it touches here** — the behaviour, the files and the people it reaches.
- **The options** — each with what it costs and what follows from it.
- **Your recommendation** — and the reason from this project's own rules or code.

Write the briefing in the reply, then ask for the choice. Wait for the answer before the next question.

Ask about the record in the same prompt. Commit when the user asked for commits, or when a route that commits brought you here (`/up`). Otherwise suggest one commit per batch for **chunks** and for a long upgrade, because it isolates a failure, and suggest the working tree for a short one. Committing and branch names follow the project's own rules — its `AGENTS.md`, or the documents it routes to — and Conventional Commits where it has none. On the default branch, branch first.

Read the **Typecheck** and **Full gate** settings now, per [Settings](#settings). The user is already answering here, so the run that follows asks nothing.

Done when you can name the involvement, say which record — commits on a named branch, or the working tree — and both settings are read.

## 3. Record the baseline

Run `pnpm peers check` and `pnpm dedupe --check` before the first change. The workspace can already carry unmet peers, so each batch answers for the delta.

Done when both outputs are saved for comparison.

## 4. Upgrade in batches

Order the batches:

1. Every dependency under the report's **Unused**, removed from its manifests and catalog rather than upgraded.
2. Every target that fixes an advisory our current version has.
3. Every patch and minor target whose report reads "nothing that touches us".
4. Each family with a major or a report item, one at a time.

With **chunks**, propose the next chunk in this order, and let the user change it before you start.

Each batch walks the same loop:

- **Write** — run the report's `taze` command with `-w` and the batch in `--include`. Edit by hand each target taze dropped, and the `packageManager` field, which takes the exact version where taze writes a caret. Then `pnpm install`. pnpm refuses a version younger than the quarantine; take the newest one it accepts.
- **Migrate** — apply each **Breaking** and **Deprecated** item. Adopt each **Improves us** item, and remove an override or workaround whose reason the upgrade took away. Rerun every generator the package feeds — a route tree, a generated API client, an i18n catalog. The package's docs name the generator; the project's scripts name the command.
- **Check** — `pnpm peers check` and `pnpm dedupe --check` show no line the baseline lacked, and the **Typecheck** command passes.
- **Record** — with commits: `build(deps): upgrade <family> to <version>`, scoped the way the project scopes a dependency change, with the lockfile. The body names each migration and each adoption.

A target that will not work at its version is held at the newest version that does, or at its current one, with the reason.

A chunk ends on step 5's gate and a short report: what moved, what was held, the gate, and the chunk you propose next. Then wait for the user.

Done when every target is installed or held with its reason.

## 5. Run the full gate

An upgrade reaches the whole workspace, so the **Full gate** runs — every command, in its order, one at a time.

A red gets a cause before a fix — [`/up-diagnose`](../up-diagnose/SKILL.md). Caused by the upgrade: migrate, or hold the package, and run the gate again. Reproduces on the base commit: it is not the upgrade's, and the report names it. A suite earns no retry: a red that passes on a second run still has a cause.

Done when every command of the **Full gate** is green on one state of the tree, or each red also reproduces on the base commit.

## 6. Report

- **What moved** — the families and their versions, with a pointer to the `/up-outdated` report for the detail.
- **Migrations and adoptions** — each one, with its files.
- **Held** — each package that did not reach its target, with its reason.
- **Decided for you** — with **auto**, each open question and the choice you took.
- **The gate** — each command and its result, against the head SHA or "the working tree on `<base SHA>`".
- **Your turn** — what is left to the user: the held packages, and the commits or the PR when they want them.

Done when the user can decide what happens to the upgrade from the report alone.

## Settings

This skill reads two **settings**, **Typecheck** and **Full gate**, at § 2. Each `###` heading below is one setting: its topic, its question, and its options. `/up-setup` reads the same headings to ask every setting up front.

1. **The settings home.** The `## Agent skills` block of the root `AGENTS.md` — or `CLAUDE.md`, whichever the project has — names where `up-*` settings live and in what form. With neither file present, first ask which to create, recommending `AGENTS.md`, which most agents read. With no such line, ask the user where to keep them, the default first:
   - **`docs/agents/<topic>.md`** (default) — one Markdown file per topic, one `##` heading per setting, named as the setting. Other headings in the file are the project's own notes.
   - **One file** — at a path the user names.
   - **Another form** — as the user describes it.

   Write their answer as one line in that block, creating the block when it is missing — for the default, `` `up-*` settings: `docs/agents/<topic>.md`, one heading per setting. ``
2. **The setting.** Read it at the settings home. Present: use it, and ask nothing.
3. **Missing.** Ask its question below, recommended answer first, with the follow-up its option needs. Write the answer at the settings home, tell the user where it went and that they can edit it there or through `/up-setup`, then continue.

### Typecheck

Topic `validation`. Question: *Which command typechecks the whole workspace?*

| Option | Follow-up | Recommend when |
| --- | --- | --- |
| **A workspace script** | The command, such as `pnpm -r run tsc` | Packages carry a `tsc` or `typecheck` script |
| **A root command** | The command, such as `pnpm exec tsc --noEmit` | One root `tsconfig.json` covers the code |
| **None** | — | The workspace has no TypeScript |

**None** leaves the check to `pnpm peers check`, `pnpm dedupe --check` and the **Full gate**.

### Full gate

Topic `validation`. Question: *Which commands prove the whole workspace after a change that reaches every package, in the order they run?*

| Option | Follow-up | Recommend when |
| --- | --- | --- |
| **These commands** | The list, in order, each with any condition on it — "when Storybook moved" | Always: propose the list from the root `package.json` scripts and the agent files' validation section where they have one — format first, then lint, typecheck, tests and build, where each exists |

Unlike **Full suite** (`/up`), which proves one branch by what it touches, the full gate covers every package at once, because an upgrade reaches all of them.

## Guardrails

- **The quarantine admits the version.** A release younger than the quarantine waits for the next upgrade. Lowering `minimumReleaseAge` or growing its exclude list is the user's call.
- **The upgrade ends in the working tree or its commits.** A push and a PR wait for the user.
