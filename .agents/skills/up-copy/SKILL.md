---
name: up-copy
description: Writes or reviews user-facing copy — labels, field descriptions, buttons, errors, empty states, hero and banner text, design system pages. Use when wording a screen, a field or a message, or when asked to review copy.
metadata:
  pack: epicparty/skills
  version: 0.1.0
---

# Copy

Write or review the words a person reads in the product.

Read [`COPY.md`](./COPY.md) and follow it, with the project's own rules from the **Copy standard** setting on top ([Settings](#settings)). They own the rules; this skill owns the steps. The one rule that decides everything: **write for the reader, not the technician**. On a documentation page for practitioners, the reader is the person who builds with the system, and `COPY.md` `## Docs for practitioners` owns that case.

## 1. Recon

Read before writing one line, then read the **Copy standard** setting — when it is missing, the recon below is what its proposed facts come from:

- The copy around the target: the same page, the sibling fields, the flow's other steps. That copy sets the voice, and a local edit does not invent a new one.
- The glossary for the terms the target touches — `/up`'s [`DECISIONS.md`](../up/DECISIONS.md) says where it lives — and the protected terms the **Copy standard** lists. On a documentation page, the terms are the tokens and props it documents, read from their source.
- The strings already shipped, for the terms already in use — in the translation catalogs where the project has them, or in the source.

A file under review includes the copy of the project components it renders, unless the user narrows the scope. Say which you included.

Done when you can name the surface, the voice its neighbours set, and the protected terms the target touches.

## 2. Establish the reader

Settle four facts, from the code and the request, and ask only for the ones you cannot find:

- **Surface**: which screen, which element, which part of the product.
- **Reader state**: what they are trying to do, and how they feel while doing it — starting from the reader the **Copy standard** describes.
- **Stakes**: routine, error, destructive, data loss. The stakes set the tone row in `COPY.md`.
- **Limits**: characters, layout width, and the longest translation that has to fit the same box.

Done when the tone row is chosen and the reader's next action is named.

## 3. Write

Apply the rules to every string in scope. When the request is a rewrite, keep the current string beside the new one. When the request leaves room for choice, offer at most three alternatives, each with the tone it takes and when to prefer it.

Done when every string in scope reads on one pass to a distracted reader who did not build the product.

## 4. Land it

- The string reaches the product the way the **Copy standard** says: through the project's translation library and its extract step where it has one, with a placeholder for every value.
- Every locale the project ships is complete before the change is done, where it ships more than one. A translation skill the **Copy standard** names fills what extract reports missing.
- A test that asserts on the old string changes with it: `rg -F '<old string>'` across the tests.
- Copy the **Copy standard** routes elsewhere — legal notices, documentation kept in one language — follows the rule it names.

## 5. Report

A rewrite reports one table, before and after, one row per string, with the rule each change applies.

A review reports findings by severity. `HIGH` misleads the reader, leaves them unable to act — a button that names no action, invokes nothing, or invokes another action than the one it names — names a system term loosely on a documentation page, or hides how to recover from an error. `MEDIUM` breaks a `COPY.md` rule without misleading: a technician word where a plain one exists, voice, terminology or capitalisation. `LOW` is isolated polish. Source is enough to verify: check every button against the action it invokes, every error for a stated fix, every description for the reader rule, and every term against the copy and glossary around it.

| Severity | Location | Before | After | Why |
| --- | --- | --- | --- | --- |

One row per root cause, listing every location it appears in. `After` holds the recommended string; other alternatives go in `Why`. `Location` is `path/to/file:line`. `Why` names the rule and the reader impact. End with `Block` when any `HIGH` remains, `Approve` otherwise. Never `Approve` coverage you did not inspect. With nothing to report, say "No actionable copy findings".

Completion criterion: `COPY.md`'s completion criterion is met for every string in scope, every test that named an old string names the new one, and a changed string is in every locale the project ships. A review meets it for the strings it proposes; the tests and locales follow when the change lands.

## Settings

This skill reads one **setting**, **Copy standard**, at § 1. Writing copy asks for it when it is missing; a review reads it when set and asks nothing. Each `###` heading below is one setting: its topic, its question, and its options. `/up-setup` reads the same headings to ask every setting up front.

1. **The settings home.** The `## Agent skills` block of the root `AGENTS.md` — or `CLAUDE.md`, whichever the project has — names where `up-*` settings live and in what form. With neither file present, first ask which to create, recommending `AGENTS.md`, which most agents read. With no such line, ask the user where to keep them, the default first:
   - **`docs/agents/<topic>.md`** (default) — one Markdown file per topic, one `##` heading per setting, named as the setting. Other headings in the file are the project's own notes.
   - **One file** — at a path the user names.
   - **Another form** — as the user describes it.

   Write their answer as one line in that block, creating the block when it is missing — for the default, `` `up-*` settings: `docs/agents/<topic>.md`, one heading per setting. ``
2. **The setting.** Read it at the settings home. Present: use it, and ask nothing.
3. **Missing.** Ask its question below, recommended answer first, with the follow-up its option needs. Write the answer at the settings home, tell the user where it went and that they can edit it there or through `/up-setup`, then continue.

### Copy standard

Topic `copy`. Question: *Who reads the product, which terms keep their exact form, which languages does it ship, and how does a string reach it?*

| Option | Follow-up | Recommend when |
| --- | --- | --- |
| **A document** | The file and heading that hold the project's copy rules | The agent files route copy to a standard already |
| **These facts** | The reader in one sentence; the protected terms; the languages and the longest one; how a string reaches the product — the translation library, its extract command, the skill that fills missing translations; and any copy routed elsewhere | The project has no copy document, and has protected terms, more than one language, or a translation library |
| **None** | — | One language, no protected terms: `COPY.md` alone, strings written in the source |

Propose the facts from the code: the i18n library in `package.json`, the catalog files and their locales, the extract script, and the brand names the existing copy keeps capitalised.
