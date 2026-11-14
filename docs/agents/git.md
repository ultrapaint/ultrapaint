# Git

Settings for the `up-*` skills that merge and name work. The `## Settings` section of `/up`
([`.agents/skills/up/SKILL.md`](../../.agents/skills/up/SKILL.md)) defines each one.

## Merge strategy

Rebase. Work lands on `main` through a pull request, rebase-merged, so every commit reaches
`main` as itself: a story is one PR, and a request without a story can be a PR of its own. A
direct `git push origin HEAD:main` is the exception, made only when the person asks for one.
