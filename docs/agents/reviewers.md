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
- **Its own review is the PR's external review**, substantial or not, and this row's request rule
  decides when one is posted: only when the `CodeRabbit` check is missing on the head commit, as
  one `@coderabbitai review` comment that counts against the cap. Where step 8 would ask the person
  whether to request an external review, the answer is already this: CodeRabbit's own review.
- **The merge gate waits for a review, not just a finished check**: the `CodeRabbit` check on the
  current head SHA reports a review, and every thread it opened is fixed or answered and resolved.
  A check that ends skipped, rate limited or neutral is no review: on a skip, comment
  `@coderabbitai full review`; on a rate limit, wait for it to lift, then `@coderabbitai review`.
  The one skip that passes is a PR whose every file `.coderabbit.yaml` filters out ("No files to
  review"), such as a pack update.
- Our own `/up-code-review` still runs: CodeRabbit does not read the issue, the ADRs or `AGENTS.md`,
  so the Spec axis is ours.
- `.coderabbit.yaml` keeps it off `.agents/skills/**` and `.claude/skills/**`: a finding on the
  pack's files goes to `epicparty/skills`, never into an edit here.
- It is not a required check: CI's `check` is ([`validation.md`](./validation.md)).
