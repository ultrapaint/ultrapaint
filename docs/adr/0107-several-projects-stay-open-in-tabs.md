# ADR 0107: Several projects stay open in tabs

Status: accepted, 2026-11-20. Amends 0031 (one project open at a time), 0099 (a switch keeps two
servers at most) and 0100 (a switch reloads the app's editor).

## Context

The desktop app kept one project open: opening another stopped the first one's server and every
agent in it (ADR 0031), and the switch reloaded the one editor page (ADR 0100). A person with work
in several projects could not leave an agent running in one while they looked at another. They
chose, on drawn alternatives (`docs/designs/projects/`), tabs over the window as Figma has them,
over the open projects listed in the project switcher's menu or a column of tiles at the window's
edge.

## Decision

- **Every open project keeps its server and its agents running**, shown or not. The desktop app
  holds a set of open projects (`OpenProjects`), each started and stopped through its own scope; a
  switch stops nothing.
- **Tabs over the window** name them, in the order they were opened: a Home tab first (the
  start page, for now the onboarding's), then one per open project with its icon and name, a
  spinner while an agent works there and a dot when one waits on the person, the current one's ×,
  and a + at the end. The + opens a menu, never a project by itself: Recent (the projects not open,
  each with a × that takes it off the list), Open folder…, Open over SSH…, New project…; what is
  chosen opens in a new tab. The tab strip is the web app's, in a view of its own over the
  projects' pages, and it is the window's title bar on a Mac.
- **One editor page is kept per open project**, so a switch back is instant and the canvas is
  where it was left. At most five are kept; past five the page of the project seen least recently
  is let go, its server still running, and loads again when its tab is chosen. Every page is the
  app's own editor (ADR 0100); what one keeps in the origin's storage is keyed by its project.
- **On the next start every tab comes back** and only the project seen last loads. Each other one
  starts its server the first time its tab is chosen, so no agent runs in a project until then.
- **Closing** is the tab's × or the palette's Close project, asking first when an agent is at
  work there; ⌘W is unchanged, since closing the window quits. **Quitting** with agents at work
  asks one question naming every project they work in.
- **An agent in another project that needs the person** shows a dot on its tab, before the
  spinner (a question or a permission waiting needs them even while its turn runs, and the chat
  says "Your turn" then too), and a notice in the window with Go to it, over the editor or Home;
  when the window is behind, the system's instead. **An agent that finishes there, or stops on an
  error, notifies too**, saying which. The main process learns it from each server's health
  (`/api/health` counts the agents working, those waiting and those whose turn failed), so a
  project whose view was let go still says so; a server that does not answer, or one reached again
  over SSH, is no news. The person's Notifications preference chooses what the system does: a
  notification, a sound, or both; Off leaves only the dot and the notice in the window. It is the
  one their editor last told the app, else the one in their profile on this machine. A project
  on screen at any moment since the last poll tells its own agents' news from its editor, so one
  event is told once.
- **A project has a name and an icon**, kept in `ultrapaint.config.json` (`name`, `icon`) so the
  whole team, every machine and an SSH copy see the same: an icon of the set in a colour, or an
  image file of the project (a favicon). Without them, the folder's name, and the project's
  favicon when it has one, else its initial in a colour. Settings › Name and icon edits both, in
  the desktop app and in a browser.
- **The sidebar's title row is the same in the desktop app and in a browser**: the mark, a slash,
  then the project's icon and name opening the project menu: Project settings (Settings › Name and
  icon), Show in Finder, Copy path. It opens no project and closes none: the desktop app does
  that from its tabs, and the command opens the one folder it was started in. The mark opens no
  menu; what concerns the app stays in Settings (About holds Check for updates and Documentation).

## Consequences

- Several servers run at once, each with its own port, run file, agents and, over SSH, its own
  connection. A change that restarts the server (an agent's path, a key, the person's folder)
  restarts every running one.
- The project switcher's menu of projects is gone; the start page and the + are where a project is
  opened.
- A project's name in the desktop's projects list follows its configuration once the project has
  been opened.
