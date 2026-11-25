# ADR 0099: A project opens on a splash that says what it is doing

Status: accepted, 2026-11-16. Amends 0031 (one project open at a time; the window loads the
start page while a project opens) and 0062 (the start page's Opening card). The decisions were
taken in the `project-loading` decisions deck, and the drawings are the Loading canvas
(`docs/designs/loading/`). Story UP-11.
Amended by 0107: a switch between open projects stops nothing, and more than two servers run.

> Extended by [0100](0100-the-desktop-app-opens-projects-in-its-own-editor.md), 2026-11-16: the editor
> a project opens in is the app's own, so a switch reloads one page of one origin.

## Context

Opening a project showed three pages in turn: the start page with an "Opening bike-shop…" card,
the editor's own splash (static in `index.html`, then React's), then the editor. A switch went
back to the start page, after the open project's server had already stopped. Nothing said what
was happening, how long it would take, or offered a way back from a misclick; a failure sent the
window to the start page with a red alert. Measured on 15 Nov 2026, a local open takes about 1 s,
so locally the problem was how it looked; over SSH it is longer, with nothing to read meanwhile.

## Decision

- **One splash from the click until the editor is ready**, the same for the app's start, a
  switch, a project over SSH and the editor opened in a browser from a repository
  (`components/opening-splash.tsx`). It shows:
  - the lockup;
  - "Opening <project>" and where the project is;
  - a bar estimated from that project's last open (none on a first open);
  - every step with its time;
  - in the desktop app, Cancel, and Escape for it (a browser has nothing to go back to).

  Past the estimate it says "Longer than last time" and shows the step's last printed line. Over
  SSH, Show log opens what ssh and the remote server printed. The bar and the steps appear after
  half a second, so a quick open shows the project alone.
- **An opening is a value both sides share** (`@ultrapaint/contracts/opening`):
  - **What it holds:** the project, its steps (`server`, `connect`, `remote`, `editor`,
    `project`, `canvas`), each step's state and time, the estimate, the log, the problem, and
    the project Cancel goes back to.
  - **In the desktop app:** `OpenProject` holds it and tells the window through the shell
    bridge's `opening` state. The server's and ssh's stderr lines and the SSH steps reach it
    through `OpeningReport`, given for the length of a launch.
  - **The editor finishes it:** it reaches its own steps (its code in, the project read with
    the designs of its canvas, the frames drawn), then hands their times back
    (`projects.openingDone`).
  - **Where the times are kept:** `ProjectStore` keeps each step's time per project
    (`lastOpening`), and the estimate is their sum. In a browser the editor keeps its own opening,
    with the estimate in `localStorage` (`ultrapaint:last-opening`).
- **The splash is drawn by the page on screen.**
  - **Over an editor:** a switch from an editor draws it over that editor, with no page of its
    own, so Cancel leaves the editor exactly as it was.
  - **On the app's own page:** with no editor on screen (the app's start, or the start screen),
    the window loads the app's own page and draws it there (the `Opening` view).
  - **On the next project's editor:** its first frame (`index.html`) draws the same header where
    React's splash puts it, so nothing jumps between the two.
- **A switch keeps the open project until the next is ready** (amends 0031's one at a time):
  1. The question about agents at work is asked first, as before.
  2. Then the next project's server starts beside the open one's.
  3. The open one is stopped only once the next one's editor is ready (`openingDone`), so its
     stop never adds to the wait.

  So Cancel, or a failure, at any step (the editor's included) returns to it at once. For the
  length of a switch two servers run.
- **Agents at work are always the person's to stop.** Asked as the switch begins: Stop and switch,
  or Stay in the open project. An agent that starts in the open project after that (with nothing
  at work as the switch began) is asked about once the next editor is ready: Stop and switch lets
  the open project go, Back to it shows it again and stops the next one. Asked once a switch: an
  agreement as it began holds to its end, and a quit during it asks nothing more.
- **A failed step stays on the splash**:
  - the step is marked;
  - the reason and what to do sit under it in the red box DESIGN.md gives an error tied to a row
    (an error's first sentence is the reason, the rest what to do);
  - Cancel goes back to the project open before, or the start screen;
  - Try again (`projects.retryOpening`) runs the same open.
- **The server answers the project's info once an opening under way has ended**
  (`useOnceOpened`), so the editor's splash never lifts on a project not yet read.
- **Paint while you wait.**
  - **The paint:** the pointer, anywhere on the splash but its buttons, paints strokes of the
    accent that dry away in about a second and a half (`PaintLayer`). A faster stroke is
    thinner, 14px at rest and never under 6px.
  - **From the start page to the editor's:** a step of the opening never wipes it. When the
    desktop app's tab gives its start page's place to the editor's page, in the app's own origin,
    the start page leaves its wet paint in the tab's `sessionStorage`
    (`ultrapaint:splash-paint`), and the editor's first frame, then React's splash, take it up as
    it has dried since. An editor served by the project's server, in another origin, starts
    clean.
  - **The bar:** it is a brush stroke laid by the mark. The mark is drawn without its bristles'
    tip and turned −15.19°, so the cut under its body lies level 1px over the bar, whose end is
    cut on the tip's slant. The paint is wettest behind the brush, with a sheen.
  - **The cursor** over the splash is the system's `cell`.
  - **Leaving:** the splash wipes away left to right once the editor is ready.
  - **Reduced motion:** the spin and the sheen stop, and the splash fades instead of wiping.

## Consequences

- During a switch the old project's agents keep working until the next server is ready.
- The editor's page still changes on a switch: its code comes again from the next server.
  UP-12 serves the editor from the app, one origin, so the switch can happen inside it.
- Installing or updating `ultrapaint` on a remote machine is a later story: its step only fails
  clearly.
