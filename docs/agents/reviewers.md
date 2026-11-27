# Reviewers

Settings for [`/up-babysit`](../../.agents/skills/up-babysit/SKILL.md), whose step 8 decides
when a PR earns an external review. Its `## Settings` section defines each one.

## External reviewers

None. A PR is reviewed by our own `/up-code-review`, on both its axes, and merges once CI's
`check` passes ([`validation.md`](./validation.md)). No external reviewer is requested.

A reviewer without a row is never requested. To enable one, install it on the repository first,
then add its row.

### CodeRabbit, while it has no quota

CodeRabbit is still installed on the `ultrapaint` organisation, but its trial has ended and it has
no review quota, so it has no row (2026-11-27). It may still post a rate-limit comment or a
neutral `CodeRabbit` check on a PR: neither is a review, and neither holds a merge.

Add its row back only once it has quota again, as it was:

| Reviewer | Kind | Its run on the head commit | Re-request with a PR comment | Max requests per PR |
| --- | --- | --- | --- | --- |
| CodeRabbit | Automatic | The `CodeRabbit` check | `@coderabbitai review`, after a rate limit has lifted | 2 |

With that row, **no review** from CodeRabbit is its `CodeRabbit` check missing on the head commit,
or ended skipped, rate limited or neutral. One skip counts as its review: a head commit whose
changes since its last review are all files `.coderabbit.yaml` filters out ("No files to review"),
such as a pack update. `.coderabbit.yaml` keeps it off `.agents/skills/**` and `.claude/skills/**`,
since a finding on the pack's files goes to `epicparty/skills`, never into an edit here.
