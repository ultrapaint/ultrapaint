# ADR 0100: The desktop app opens projects in its own editor

Status: accepted, 2026-11-16. Amends 0031 (the window loads the editor from the project's
server) and extends 0099 (a project opens on a splash). Story UP-12.
Amended by 0107: one page of the app's editor is kept per open project; a switch shows it rather than reloading one.
Amended by 0113: Ultrapaint Dev opens each local project in the editor its `ultrapaint --dev` serves.

## Context

Each project's server served the editor's code to the window, from a new port on every start
(`--port 0`). So the 4.2 MB of code downloaded again on every open, through the tunnel for a
project over SSH. The browser storage (theme, panel widths, the last canvas, shortcuts) belonged
to an origin that was gone the next time. A switch also loaded a page from another origin, so the
splash was drawn on two pages with a blank moment between them.

## Decision

- **The window shows the app's own copy of the editor**, served under the app's scheme at
  `ultrapaint://app/` (`app-editor.ts`). It is one origin for every project: its code is the
  app's files, its storage stays from one open to the next, and the start page shares it. An
  address that names no file is the editor's own page, as a server serves it; its pages may
  connect to themselves and a server on this machine, and nothing else (`connect-src`).
- **The editor learns its server from the shell bridge** (`editorServer`, told before the page
  loads); `Platform.serverUrl` is that server's WebSocket. Every other request goes to the
  server's own address (`serverAddress`): the Figma import, the images of a canvas and the
  health check. Opened from a repository in a browser, the editor is still served by its
  server, as before (0017).
- **Every server the app starts allows the app's origin.** A local one is given
  `--allowed-origin ultrapaint://app`. One over SSH gets it by `ULTRAPAINT_ALLOWED_ORIGIN`,
  which a remote command too old for the flag ignores where it would refuse it. The server
  lets that origin in on `/ws` and the Figma import, answers its requests with that origin
  allowed (CORS), and answers the preflight before a POST.
- **A server of the app's version opens in the app's editor; any other in the editor it serves
  itself.** The version is read from `/api/health`, so an editor and a server of different
  versions never talk to each other. A remote machine on another version opens as before
  (`OpenProject`'s `appEditor`).
- **A switch loads the app's editor again, from the same origin.** The stores are not reset
  live: dozens of them keep a project's state, and a reload of a page whose code is already on
  this machine costs about 0.3 s. The splash of 0099 is drawn from the first frame
  (`index.html`), so nothing flashes. The location is kept as before (`keepLocation`), whether
  the page was the app's editor or a server's.
- **What the editor keeps per project is keyed by project** now that one storage serves every
  project: the canvas opened last (`ultrapaint:canvas:<repo>`).

## Consequences

- A link copied from the app's editor names `ultrapaint://app/` with the node in its query.
  An agent reads it as it reads a server's (`parseEditorLink` takes the app's scheme). It does
  not open in a browser, as a link to a server's port never stayed valid either.
- A remote machine that runs `ultrapaint` from a checkout between releases reports the release's
  version and is shown in the app's editor, though its contract may differ. The version is the
  one signal the server gives.
- Measured on 16 Nov 2026 in the desktop app, a project reopened fetched 0.42 MB from its
  server: the designs' images. The editor's code came from the app. Before, an open fetched
  4.2 MB.
- Installing or updating `ultrapaint` on a remote machine of another version is still a later
  story: until then that machine's projects open in its own editor.
