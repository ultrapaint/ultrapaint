/**
 * The desktop app's news of an agent in another open project (ADR 0107,
 * `docs/designs/projects/4-notice`): shown as a toast over the view on screen, the editor or Home's
 * start page, "<project>: an agent asks you something", with Go to it showing that project's tab.
 * The app tells every view (`Platform.projectNotice`) and takes it back once the tab is shown or
 * closed, or the toast closed in any view; only the view on screen is seen. Nothing in a browser,
 * which has one project.
 *
 * The editor tells of its own project's agents itself (`agent-notifications.ts`): only while its
 * tab is on screen, the app only of the others, so one event is told once.
 */
import type { ProjectNotice } from "@ultrapaint/contracts/shell-bridge";
import { createElement } from "react";
import { toast } from "sonner";
import { platform } from "../platform.ts";
import { type Notifications, usePreferences } from "../state/preferences.ts";

/** How long a notice stays: the tab's dot says it after. */
const NOTICE_MS = 10_000;

const DOT: Record<ProjectNotice["news"], string> = {
  asks: "bg-warning",
  done: "bg-agent",
  stopped: "bg-destructive",
};

/** The toast's own id, kept apart from the editor's other toasts. */
const toastId = (notice: ProjectNotice) => `project-notice-${notice.id}`;

/**
 * In the desktop app, whether a tab other than this project view's own is on screen (Home, or
 * another project): its agents' news is then the app's to tell. False in a browser.
 */
export const anotherTabShown = (shell = platform()): boolean => {
  const own = shell.projectId?.current();
  const tabs = shell.tabs?.current();
  if (!(own && tabs)) {
    return false;
  }
  return !tabs.some((tab) => tab.id === own && tab.shown);
};

/**
 * The dot before a notice's words: the warning's colour for a question, as its tab's dot, the
 * destructive one for an agent that stopped on an error.
 */
const dotOf = (notice: ProjectNotice) =>
  createElement("span", {
    "aria-hidden": true,
    className: `size-2 shrink-0 rounded-full ${DOT[notice.news]}`,
  });

/**
 * Tells the desktop app the person's Notifications preference as this editor holds it, as it
 * loads and at each change: the app tells of the projects not on screen by it. An editor of a
 * project on another machine keeps the profile there, so the app hears it from the editor rather
 * than reading this machine's profile. Nothing in a browser.
 */
export const followNotificationsPreference = () => {
  const prefer = platform().notifications?.prefer;
  if (!prefer) {
    return () => undefined;
  }
  const tell = (preference: Notifications) => {
    // Untold, the app goes on with the preference it had.
    prefer(preference).catch(() => undefined);
  };
  tell(usePreferences.getState().notifications);
  return usePreferences.subscribe((now, before) => {
    if (now.notifications !== before.notifications) {
      tell(now.notifications);
    }
  });
};

/** Follows the app's notices for the rest of the view's life; the function returned stops. */
export const followProjectNotices = () => {
  const shell = platform();
  const source = shell.projectNotice;
  if (!source) {
    return () => undefined;
  }
  let shown: ProjectNotice | null = null;
  const over = (notice: ProjectNotice) => {
    // The shell takes it back from every view; a shell that cannot is no worse than before.
    shell.projects?.dismissNotice(notice.id).catch(() => undefined);
  };
  const take = (notice: ProjectNotice | null) => {
    if (shown && shown.id !== notice?.id) {
      toast.dismiss(toastId(shown));
      shown = null;
    }
    // This view's own project is news to no one looking at it.
    if (
      !notice ||
      notice.id === shown?.id ||
      notice.project === shell.projectId?.current()
    ) {
      return;
    }
    shown = notice;
    toast(notice.title, {
      action: {
        label: "Go to it",
        onClick: () => {
          // A tab closed meanwhile has nothing to show.
          shell.projects?.show(notice.project).catch(() => undefined);
        },
      },
      duration: NOTICE_MS,
      icon: dotOf(notice),
      id: toastId(notice),
      // Over, it is over in every view: none shows it again, one loaded later included.
      onAutoClose: () => over(notice),
      onDismiss: () => over(notice),
    });
  };
  take(source.current());
  return source.subscribe(take);
};
