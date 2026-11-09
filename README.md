<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/brand/lockup-white.svg">
    <img alt="Ultrapaint" height="72" src="docs/brand/lockup.svg">
  </picture>
</p>

<p align="center">
  <strong>Design in your repository, with your agents beside you.</strong>
</p>

<p align="center">
  <a href="#installation">Installation</a> ·
  <a href="#documentation">Documentation</a> ·
  <a href="#desktop-app">Desktop app</a> ·
  <a href="#license">License</a>
</p>

<br>

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
> The command needs [Node.js](https://nodejs.org) 24 or newer.
>
> Agents are optional. To use one, install it and sign in first:
>
> - Claude Code: install [Claude Code](https://claude.com/product/claude-code) and run `claude` once
> - Codex: install [Codex CLI](https://developers.openai.com/codex/cli) and run `codex login`

### Command line

```bash
npm install -g https://github.com/ultrapaint/ultrapaint/releases/latest/download/ultrapaint.tgz
```

Then run `ultrapaint` in the repository you want to design in. It opens the editor at
`http://127.0.0.1:4770`; `ultrapaint --help` lists every option. Run the install again to update.

### Desktop app

On macOS (Apple silicon), with Homebrew:

```bash
brew install --cask ultrapaint/tap/ultrapaint
```

On Linux, download the AppImage (it updates itself) or the `.deb` from the
[latest release](https://github.com/ultrapaint/ultrapaint/releases/latest).

The app isn't signed yet. On macOS, run `xattr -dr com.apple.quarantine /Applications/Ultrapaint.app`
once after installing or updating it, or macOS will say it is damaged. Windows is not supported yet.

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

## License

Ultrapaint is free software under the [GNU AGPL v3](LICENSE). Use it, change it, and run it for
your team as you like; if you distribute a changed version or offer one as a service, publish your
changes under the same licence. What you design and build with it is yours.

This licence covers every version of Ultrapaint in this repository, including the commits made
before the `LICENSE` file was added.
