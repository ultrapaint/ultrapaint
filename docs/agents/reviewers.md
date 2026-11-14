# Reviewers

Settings for [`/up-babysit`](../../.agents/skills/up-babysit/SKILL.md), whose step 8 decides
when a PR earns an external review. Its `## Settings` section defines each one.

## External reviewers

| Reviewer | Kind | Request with a PR comment | Max per PR |
| --- | --- | --- | --- |
| CodeRabbit | Normal, and it reviews on its own | `@coderabbitai review`, only when the head commit has no CodeRabbit review (see below) | 2 |

A reviewer without a row is never requested. To enable another one, install it on the repository
first, then add its row and its section below.

### CodeRabbit

- It is installed on the `ultrapaint` organisation for every repository, and **reviews each PR on
  its own** when it opens and as commits are pushed. Its run shows as the `CodeRabbit` check on the
  head commit; its findings arrive as review threads from `coderabbitai`, and its summary as one PR
  comment it edits.
- **Its own review is the PR's external review**, substantial or not. Where step 8 would ask the
  person whether to request an external review, the answer is already this: CodeRabbit's own review.
- **The head commit has no CodeRabbit review** when its `CodeRabbit` check is missing, or ends
  skipped, rate limited or neutral. That is the one case a request is posted: `@coderabbitai review`,
  after a rate limit has lifted. Every request counts against the cap of 2 per PR. The exception is
  a head commit whose changes since CodeRabbit's last review are all files `.coderabbit.yaml`
  filters out ("No files to review"), such as a pack update or a pack-only commit on a PR with other
  files: its skip is its review, and nothing is requested.
- **The merge gate waits for a review, not just a finished check**: the head commit has a CodeRabbit
  review, or is that exception, and every thread CodeRabbit opened is fixed or answered and
  resolved. With the cap spent and still no review, the PR stays open and the report says so.
- Our own `/up-code-review` still runs: CodeRabbit does not read the issue, the ADRs or `AGENTS.md`,
  so the Spec axis is ours.
- `.coderabbit.yaml` keeps it off `.agents/skills/**` and `.claude/skills/**`: a finding on the
  pack's files goes to `epicparty/skills`, never into an edit here.
- It is not a required check: CI's `check` is ([`validation.md`](./validation.md)).
