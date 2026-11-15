---
name: up-release
description: Cuts a release of the project when its merged changes are ready to ship together — checks each change's bump, cuts the version the Releases setting describes, and follows it to its receipt.
disable-model-invocation: true
metadata:
  pack: epicparty/skills
  version: 0.2.0
---

# Release

A merge lands one change; a **release** puts a batch of them in front of the project's users under one version. When the batch is ready is the user's call, so this skill runs only when they ask for it — never as the step after a merge. It cuts one release, the way the **Releases** setting describes ([Settings](#settings)).

A published version is permanent: a registry never reuses one, and a version withdrawn after the fact leaves a gap every user can see. So every check here happens **before** the cut.

## 1. Read the setting

Read **Releases**. At **None**, the project versions nothing and a merge is its release: say so, and stop.

Done when you hold the setting, or have stopped at **None**.

## 2. Collect the batch

List every change merged since the last release, from the tool the setting names:

- **Changesets** — each file in `.changeset/` other than its README and config, with its bump and its entry, and the open release pull request where the release workflow keeps one.
- **Commit-driven** — the commits on the default branch since the last release tag, each with the bump its type implies.
- **Tags by hand** — the commits since the last tag (`git describe --tags --abbrev=0`).

Hold each change's bump to the **Bump rules** (`/up` `## Settings`, under **Releases**). A fix filed as `minor`, a new capability filed as `patch`, and a change a project must act on without its **Action:** line are findings. Correct a mislabelled changeset in a pull request of its own before the release, so the version says what it means.

Done when every change in the batch is listed with its bump, and each bump agrees with the rules or is named as a finding.

## 3. Propose it

Show the user the batch: the version it makes, the changes under it with their bumps, and the findings. A must-act change leads, with its **Action:** line. Then ask one question: cut this release now, or wait for more.

Done when the user has said to cut it, or to wait — and waiting ends the run.

## 4. Cut it

The way the setting says:

- **A release pull request** (Changesets' release workflow, release-please) — read its head right before merging, and confirm it holds exactly the batch you showed: a push to the default branch can rebuild it in the seconds between. Then merge it pinned to that head, by the **Merge strategy**: `gh pr merge <n> --match-head-commit <sha>`.
- **Tags by hand** — bump the version where the setting says, commit it, then tag that commit and push the tag.

Done when the release is cut on the head you checked.

## 5. Confirm it published

Follow the release through the setting's publish step to its **receipt**, the way `/up-ship` confirms a deploy: the workflow run's result, then the receipt itself — the registry's version (`npm view <package> version`), the tag and its release notes, the deploy.

A publish that **stages** the version for approval ends with the user: name the version, its stage id, and the order to approve several in. Approving an older version after a newer one moves `latest` back to the older.

Done when the receipt shows the new version, or the user holds the approval to make.

## 6. Report

`/up-ship`'s three sections: **Details** — the batch, the run, the receipt; **TL;DR** — the version and where it is live; **Your turn** — an approval to make, a finding to fix before the next release, or **"Nothing — released."**

## Guardrails

- **The user releases.** Merging a pull request is never a reason to release, and nothing here cuts one unasked.
- **Cut on the head you checked.** A release pull request merged unpinned can carry a different batch from the one the user approved.
- **A version names its batch.** A batch that needs fixing waits for its fix; withdrawing a published or staged version is the user's call, and the report says it would leave a gap.

## Settings

This skill reads two settings, both defined in `/up` `## Settings` together with the steps that find them:

- **Releases** at § 1. This skill acts on it, so it asks for it when it is missing.
- **Merge strategy** at § 4, when it cuts through a pull request.
