# The desktop app

The same editor in a window of its own, with a list of projects and a switcher in the place of
the project's name ([ADR 0031](../adr/0031-the-desktop-app.md)). It starts each project's server
itself and brings the agents' adapters with it, so the editor needs no Node.js of yours. It finds
`claude` and `codex` on the `PATH` your login shell has. A project whose server the command
already runs is opened in it, and left running.

Node.js 22.12 or newer is needed only to make a new application (Sync's **Start an
application…**, or `ultrapaint new` with code): its packages are installed and it runs with it.
When Node.js is missing or too old, a banner over the editor says so, with where to get it.

## Agents

**Settings** › **Agents** › **On this computer** lists the agents the app found, where, and whether
they are signed in. One it cannot find is offered as a download into the app's own data
(**Download**, with its size); **Choose…** points it at an executable of yours, and **Use PATH**
goes back to the one on your `PATH`. Codex signs in there with **Sign in with ChatGPT**; Claude
Code by running `claude` once in a terminal, or with an API key the app keeps in the system's
keychain. An agent the app downloaded earlier whose version is not the one this version of the app
pins shows as missing until you download it again.

## The start screen

With no project open (at the first start, when a project could not start, or from **New
project…** in the switcher), the app shows its start screen. **Start a new project** takes a
prompt, what you want to make, and three choices under it:

- where it goes: **New folder in ~/Ultrapaint**, or **Choose a folder…**;
- the look: **Agent picks the look**, or **I’ll pick the look**, which opens the look page before
  the first screen ([The design system](design-system.md#picking-a-look));
- the model, from the agents on this computer.

Send it and the app writes the project, opens it, and sends your prompt in its first chat. A
chosen folder that holds an application is opened as it is, and the prompt sent there. A folder
that is already an Ultrapaint project is not written into: a dialog offers to open it instead.

**Recent projects** lists the projects; a click opens one. **Open project** opens anything on
disk: **A folder on this computer…** or **A folder over SSH…**. Opened from the switcher, the
screen keeps the open project behind it, with **Back to** it at the top.

**Remove from list**, in a project's **…** menu on the start screen or in the switcher, takes a
project off the list and deletes the session the app kept for it. Its folder stays as it is, and
the project open now cannot be removed. When that session holds designs not saved to the
project's folder (a folder with no configuration file), the app asks first.

## From the command line

`ultrapaint new <folder>` writes a new project without the app: a configuration, a designs
directory and, with `--code app` (the default) or `--code root`, an application to design with
(`--code none` for designs only). `--template starter` gives it a component for each system
component; `--template blank` (the default) none. `--git` turns writing to git on, with
`git init` and a first commit.

```bash
ultrapaint new ~/Ultrapaint/Acme --template starter --code app --git
cd ~/Ultrapaint/Acme && ultrapaint
```

## Over SSH

**Open over SSH…**, in the switcher, or **A folder over SSH…** on the start screen, opens a folder
on another machine: a **Host** (an alias of your `~/.ssh/config`, offered as you type, or
`user@host:port`), the **Folder** there, and the **Command** that runs the editor there when it
is not `ultrapaint` on that machine's `PATH` (`node ~/ultrapaint/scripts/cli.ts` for a checkout,
say). The app runs your own `ssh`, with your configuration, keys and agent, starts the server in
that folder from your login shell there, and forwards its port to this machine; agents run on
the other machine, with its agents. That machine needs Node.js 24 or newer and the `ultrapaint`
command, installed as in [Install and start](install.md). The app cannot type a password or a
key's passphrase: load the key into your agent (`ssh-add`) or set one up (`ssh-copy-id <host>`),
and connect once in a terminal to accept the host's key. A dropped connection is made again by
itself, the canvas saying so meanwhile; quitting or switching stops what the app started there.

## Getting it

Each [release](https://github.com/ultrapaint/ultrapaint/releases) carries it, unsigned for now
([ADR 0051](../adr/0051-desktop-distribution.md)):

- **macOS** (Apple silicon): `brew install --cask ultrapaint/tap/ultrapaint`, or the `.dmg`. macOS
  says an unsigned app "is damaged": run `xattr -dr com.apple.quarantine /Applications/Ultrapaint.app`
  once after installing or updating it. When a newer release is out, a banner over the editor says
  so, with `brew upgrade --cask ultrapaint` to copy and the download.
- **Linux**: the AppImage, which updates itself (it downloads the release in the background and
  installs it when the app quits), or the `.deb`, whose updates the same banner announces.

Windows is not supported yet. To build it from a checkout, for the machine you are on (an
AppImage and a deb on Linux, a dmg and a zip on macOS), or run it from the checkout:

```bash
pnpm desktop:build                              # installers in apps/desktop/release
pnpm desktop:dev                                # the app from the checkout, the server from its sources
pnpm desktop:dev -- ~/code/your-repo            # opening a folder, which joins the list
```
