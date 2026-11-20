/**
 * The desktop app's news of an agent in another open project (ADR 0107,
 * `docs/designs/projects/4-notice`): shown as a toast over the editor on screen, "<project>: an
 * agent asks you something", with Go to it showing that project's tab. The app tells every page
 * (`Platform.projectNotice`) and takes it back once the tab is shown or closed; only the page on
 * screen is seen. Nothing in a browser, which has one project.
 *
 * The page's own project is told of by the page itself (`agent-notifications.ts`): it tells only
 * while its tab is on screen, the app only of the others, so one event is told once.
 */
import type { ProjectNotice } from "@ultrapaint/contracts/shell-bridge";
import { createElement } from "react";
import { toast } from "sonner";
import { platform } from "../platform.ts";

/** How long a notice stays: the tab's dot says it after. */
const NOTICE_MS = 10_000;

/** The toast's own id, kept apart from the editor's other toasts. */
const toastId = (notice: ProjectNotice) => `project-notice-${notice.id}`;

/**
 * In the desktop app, whether a tab other than this page's project's is on screen (Home, or
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

/** The dot before a notice's words: the warning's colour for a question, as its tab's dot. */
const dotOf = (notice: ProjectNotice) =>
  createElement("span", {
    "aria-hidden": true,
    className: `size-2 shrink-0 rounded-full ${notice.news === "asks" ? "bg-warning" : "bg-agent"}`,
  });

/** Follows the app's notices for the rest of the page's life; the function returned stops. */
export const followProjectNotices = () => {
  const shell = platform();
  const source = shell.projectNotice;
  if (!source) {
    return () => undefined;
  }
  let shown: ProjectNotice | null = null;
  const take = (notice: ProjectNotice | null) => {
    if (shown && shown.id !== notice?.id) {
      toast.dismiss(toastId(shown));
      shown = null;
    }
    // This page's own project is news to no one looking at it.
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
    });
  };
  take(source.current());
  return source.subscribe(take);
};
