# ADR 0103: A release starts the tap's workflow

Status: accepted, 2026-11-17. Amends 0051 (when the tap follows a release, and the main
repository's key to it).

## Context

Under 0051 the cask in `ultrapaint/homebrew-tap` follows the latest release by the tap's own
workflow ("Follow Ultrapaint's releases", `follow.yml`), run hourly, and the main repository keeps
no key to the tap. GitHub runs that schedule late: 4 to 10 hours apart on 15 and 16 Nov. After
v0.2.0 was published on 17 Nov, the cask stayed at 0.1.5 until the workflow was dispatched by
hand. The release workflow's `GITHUB_TOKEN` cannot start a workflow in another repository.

## Decision

- The release workflow's `publish` job, once the release is published, starts the tap's
  `follow.yml` (`gh workflow run`), so the cask follows within minutes.
- It starts it with `HOMEBREW_TAP_TOKEN`, a secret of the main repository: a fine-grained personal
  access token for `ultrapaint/homebrew-tap` alone, with Actions: read and write. It can start the
  tap's workflows, not write the cask; the tap still writes it with its own token.
- A start that fails, or a missing secret, warns and leaves the run green: the release is already
  published, and the tap's schedule points the cask at it anyway. A red run would report a release
  that worked.
- The tap keeps its hourly schedule, as the fallback, and its `workflow_dispatch`.
- A fine-grained token over a GitHub App: one secret, the narrowest scope that works. An App would
  not expire, but needs an app, its private key and a step that mints a token, for one call.

## Consequences

- The token expires (set for a year on 17 Nov 2026). Until a new one is set
  (`gh secret set HOMEBREW_TAP_TOKEN -R ultrapaint/ultrapaint`), each release warns and its cask
  waits for the tap's schedule.
- If GitHub disables the tap's schedule after 60 days without activity there, the release's start
  fails and warns too, until the workflow is enabled again from the tap's Actions tab.
