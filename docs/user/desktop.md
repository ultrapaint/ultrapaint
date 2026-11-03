# The desktop app

The same editor in a window of its own, with a list of projects and a switcher in the header
([ADR 0031](../adr/0031-the-desktop-app.md)). It starts each project's server itself and
brings the agents' adapters inside it: it needs Node.js (22.12 or newer) only for the preview,
and finds it, with `claude` and `codex`, on the PATH your login shell has. An agent it cannot
find is offered under Settings, Agents, as a download into the app's own data; Codex signs in
with ChatGPT from there, Claude Code by running `claude` once in a terminal or with an API key
the app keeps in the system's keychain. A project whose server the command already runs is
opened in it, and left running.

**New design**, on the welcome page and in the switcher, starts a design in a folder with no
code yet: a name, a folder (`~/Ultrapaint/<name>` unless you pick another), a template (**Blank**:
no components and a theme that declares nothing; **Starter components**: one for each system component,
by the same name, props, parts and variants, on Base UI, so a design is implemented onto them one
to one), the
code in `app/` or at the folder's root, and whether to keep it in git (off by default; on, it is
`git init` and a first commit, `Start <name>`). The app writes it step by step, installs it with
pnpm when it is on your PATH and npm otherwise, adds it to the list and opens it on Sync's
**Define** step. A step that fails says why and leaves what was written: open it as it is, or
try again, which finishes it.

The command does the same without the app:

```bash
ultrapaint new ~/Ultrapaint/Acme --template starter --code app --git
cd ~/Ultrapaint/Acme && ultrapaint
```

**Open over SSH…**, on the welcome page and in the switcher, opens a folder on another machine:
a host (an alias of your `~/.ssh/config`, offered as you type, or `user@host:port`), the folder
there, and the command that runs the editor there when it is not `ultrapaint` on that machine's
PATH (`node ~/ultrapaint/scripts/cli.ts` for a checkout, say). The app runs your own `ssh`, with
your configuration, keys and agent, starts the server in that folder from your login shell there,
and forwards its port and the preview's to this machine; agents and the preview run on the other
machine, with its Node.js and its agents. That machine needs Node.js and the `ultrapaint`
command, installed as above. The app cannot type a password or a key's passphrase: load the key
into your agent (`ssh-add`) or set one up (`ssh-copy-id <host>`), and connect once in a terminal
to accept the host's key. A dropped connection is made again by itself, the canvas saying so
meanwhile; quitting or switching stops what the app started there.

Releases do not carry it yet: build it from a checkout, for the machine you are on (an AppImage
and a deb on Linux, a dmg and a zip on macOS, unsigned), or run it from the checkout.

```bash
pnpm desktop:build                              # installers in apps/desktop/release
pnpm desktop:dev                                # the app from the checkout, the server from its sources
pnpm desktop:dev -- ~/code/your-repo            # opening a folder, which joins the list
```
