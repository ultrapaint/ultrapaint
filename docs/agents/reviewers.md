# Reviewers

Settings for [`/up-babysit`](../../.agents/skills/up-babysit/SKILL.md), whose step 8 decides
when a PR earns an external review. Its `## Settings` section defines each one.

## External reviewers

| Reviewer | Kind | Its run on the head commit | Re-request with a PR comment | Max requests per PR |
| --- | --- | --- | --- | --- |
| CodeRabbit | Automatic | The `CodeRabbit` check | `@coderabbitai review`, after a rate limit has lifted | 2 |

**No review** from CodeRabbit is the pack's default: its `CodeRabbit` check missing on the head
commit, or ended skipped, rate limited or neutral. One skip counts as its review: a head commit
whose changes since its last review are all files `.coderabbit.yaml` filters out ("No files to
review"), such as a pack update.

A reviewer without a row is never requested. To enable another one, install it on the repository
first, then add its row.

### CodeRabbit

- It is installed on the `ultrapaint` organisation for every repository. Its findings arrive as
  review threads from `coderabbitai`, and its summary as one PR comment it edits.
- Our own `/up-code-review` still runs: CodeRabbit does not read the issue, the ADRs or `AGENTS.md`,
  so the Spec axis is ours.
- `.coderabbit.yaml` keeps it off `.agents/skills/**` and `.claude/skills/**`: a finding on the
  pack's files goes to `epicparty/skills`, never into an edit here.
- It is not a required check: CI's `check` is ([`validation.md`](./validation.md)).
