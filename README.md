# Ultrapaint

Ultrapaint is a design tool that lives in your repository. You design on a canvas with your own
design tokens and components, Claude Code and Codex design right next to you, and when a page is
ready an agent ships it as your application's code.

Designs are plain JSON files in your repo, reviewed and committed like any other code. Everything
runs on your machine.

## Why?

Design tools and codebases drift apart. Figma has one palette, the frontend has another, and
handing off a screen means redrawing it in code. Ultrapaint keeps one source of truth in the repo:

- **No design system yet?** It reads what your code actually uses and builds one with you.
- **Designs in Figma?** Import the `.fig` file: its variables become tokens, its frames become
  editable pages.
- **Code and design out of sync?** **Sync** shows what changed on each side and lets you pick.
- **Starting from scratch?** It sets up a React app with components ready to design with.

## Installation

> [!WARNING]
> Ultrapaint needs [Node.js](https://nodejs.org) 24 or newer. It isn't on npm yet: install it from
> a [release](https://github.com/ultrapaint/ultrapaint/releases) (with the [GitHub CLI](https://cli.github.com)).
>
> Agents are optional. To use one, install it and sign in first:
>
> - Claude Code: install [Claude Code](https://claude.com/product/claude-code) and run `claude` once
> - Codex: install [Codex CLI](https://developers.openai.com/codex/cli) and run `codex login`

```bash
gh release download --repo ultrapaint/ultrapaint --pattern '*.tgz'
pnpm add -g ./ultrapaint-*.tgz
```

Then run it in the repository you want to design in:

```bash
cd ~/code/your-repo
ultrapaint
```

It opens the editor at `http://127.0.0.1:4770`. `ultrapaint --help` lists every option. There's
also a [desktop app](docs/user/desktop.md), built from a checkout for now.

## Some notes

We are very early. Expect bugs and breaking changes.

It works with React, Vite and Tailwind v4 today. Other frameworks and styling systems are planned.

## Documentation

- [Install and start](docs/user/install.md)
- [First run](docs/user/first-run.md)
- [Agents](docs/user/agents.md)
- [Design documents](docs/user/designs.md)
- [Components](docs/user/components.md)
- [The design system and Sync](docs/user/design-system.md)
- [Importing a Figma file](docs/user/figma.md)
- [Pages, URLs and canvases](docs/user/pages.md)
- [Commands and settings](docs/user/reference.md)
- [Using it from another machine](docs/user/remote-access.md)
- [The desktop app](docs/user/desktop.md)
- [Development](docs/development.md)
