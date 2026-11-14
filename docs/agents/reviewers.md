# Reviewers

Settings for [`/up-babysit`](../../.agents/skills/up-babysit/SKILL.md), whose step 8 decides
when a PR earns an external review. Its `## Settings` section defines each one.

## External reviewers

None. No review bot is installed on `ultrapaint/ultrapaint`, so step 8 runs our own review alone.
To enable one, install it on the repository first, then replace this line with its row: the
reviewer, its kind (normal or security), the PR comment that requests it, and the most requests
per PR.
