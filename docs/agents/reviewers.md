# Reviewers

Settings for [`/up-babysit`](../../.agents/skills/up-babysit/SKILL.md), whose step 8 decides
when a PR earns an external review. Its `## Settings` section defines each one.

## External reviewers

| Reviewer | Kind | Request with a PR comment | Max per PR |
| --- | --- | --- | --- |
| CodeRabbit | Normal, and it reviews on its own | `@coderabbitai review`, only when its own run is missing | 1 |

A reviewer without a row is never requested. To enable another one, install it on the repository
first, then add its row and its section below.

### CodeRabbit

- It is installed on the `ultrapaint` organisation for every repository, and **reviews each PR on
  its own** when it opens and as commits are pushed. Its run shows as the `CodeRabbit` check on the
  head commit; its findings arrive as review threads from `coderabbitai`, and its summary as one PR
  comment it edits.
- **Its own review is the PR's external review**, substantial or not. Step 8 never asks the person
  whether to request one and never requests it, unless the `CodeRabbit` check is missing on the
  head commit; then one `@coderabbitai review` comment, which counts against the cap.
- **The merge gate waits for it**: the `CodeRabbit` check has finished on the current head SHA, and
  every thread it opened is fixed or answered and resolved.
- Our own `/up-code-review` still runs: CodeRabbit does not read the issue, the ADRs or `AGENTS.md`,
  so the Spec axis is ours.
- `.coderabbit.yaml` keeps it off `.agents/skills/**` and `.claude/skills/**`: a finding on the
  pack's files goes to `epicparty/skills`, never into an edit here.
- It is not a required check: CI's `check` is ([`validation.md`](./validation.md)).
