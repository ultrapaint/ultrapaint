# Reviewers

Settings for [`/up-babysit`](../../.agents/skills/up-babysit/SKILL.md), whose step 8 decides
when a PR earns an external review. Its `## Settings` section defines each one.

## External reviewers

| Reviewer | Kind | Request with a PR comment | Max per PR |
| --- | --- | --- | --- |
| CodeRabbit | Normal | `@coderabbitai review` | 1 |

A reviewer without a row is never requested. To enable another one, install it on the repository
first, then add its row and its section below.

### CodeRabbit

- It is installed on the `ultrapaint` organisation for every repository, and **reviews each PR on
  its own** when the PR opens and as commits are pushed. Its findings arrive as review comments
  from `coderabbitai`, and its run shows as the `CodeRabbit` status on the head commit.
- Request it with the comment above only when its own review did not run, or for a full review
  after large changes. Each request comment counts against the cap.
- It is not a required check: CI's `check` is (`validation.md`).
