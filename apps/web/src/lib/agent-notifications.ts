/**
 * Tells the person, while the editor's window is away (hidden or not focused), that an agent
 * finished, stopped or asks something, as Settings › General › Notifications chose: a system
 * notification, a short sound, both, or nothing. Nothing is said for what happens in sight.
 */
import type { Thread } from "@ultrapaint/contracts/threads";
import { useAgents } from "../state/agents.ts";
import { showLeftPanel } from "../state/panels.ts";
import { usePreferences } from "../state/preferences.ts";
import { reportError } from "../state/project.ts";
import { threadView } from "./thread-view.ts";

/** What changed in a thread that is news to someone away. */
export type ThreadNews = "asks" | "done" | "stopped";

interface Seen {
  readonly busy: boolean;
  readonly waiting: boolean;
}

/** The news between what a thread was and what it is now, if any. */
export const newsOf = (
  before: Seen | undefined,
  thread: Pick<Thread, "status" | "summary">
): ThreadNews | null => {
  const now = threadView(thread);
  if (now.waiting && !before?.waiting) {
    return "asks";
  }
  if (before?.busy && !now.busy) {
    return now.failed ? "stopped" : "done";
  }
  return null;
};

/** The notification's words for a thread's news. */
export const notificationOf = (
  title: string,
  news: ThreadNews
): { body: string; title: string } => {
  const name = title.trim() || "A chat";
  return {
    asks: { body: "The agent asks you something.", title: name },
    done: { body: "The agent finished.", title: name },
    stopped: { body: "The agent stopped before it finished.", title: name },
  }[news];
};

const away = () => document.hidden || !document.hasFocus();

/** Two soft notes, a fifth apart: short enough to hear across a room and not mind. */
const chime = () => {
  const Context =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!Context) {
    return;
  }
  const ctx = new Context();
  const notes = [660, 990];
  notes.forEach((frequency, i) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const start = ctx.currentTime + i * 0.14;
    osc.frequency.value = frequency;
    osc.type = "sine";
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(0.12, start + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.35);
    osc.connect(gain).connect(ctx.destination);
    osc.start(start);
    osc.stop(start + 0.4);
  });
  setTimeout(() => ctx.close(), 1000);
};

/** Asks the system for permission to notify, once the person picked a notification. */
export const askToNotify = async (): Promise<NotificationPermission> => {
  if (typeof Notification === "undefined") {
    return "denied";
  }
  if (Notification.permission !== "default") {
    return Notification.permission;
  }
  return await Notification.requestPermission();
};

const tell = (thread: Thread, news: ThreadNews) => {
  const { notifications } = usePreferences.getState();
  if (notifications === "off" || !away()) {
    return;
  }
  if (notifications === "sound" || notifications === "both") {
    chime();
  }
  if (
    (notifications === "notification" || notifications === "both") &&
    typeof Notification !== "undefined" &&
    Notification.permission === "granted"
  ) {
    const { body, title } = notificationOf(thread.title, news);
    const shown = new Notification(title, { body, silent: true });
    shown.onclick = () => {
      window.focus();
      showLeftPanel("chat");
      useAgents.getState().open(thread.id).catch(reportError);
      shown.close();
    };
  }
};

/** Follows the threads for the rest of the editor's life, telling of their news while away. */
export const followAgentNotifications = () => {
  const seen = new Map<string, Seen>();
  const take = (threads: readonly Thread[], announce: boolean) => {
    for (const thread of threads) {
      const news = newsOf(seen.get(thread.id), thread);
      const { busy, waiting } = threadView(thread);
      seen.set(thread.id, { busy, waiting });
      if (announce && news) {
        tell(thread, news);
      }
    }
  };
  // What the list holds as it is first read is not news.
  take(useAgents.getState().threads, false);
  return useAgents.subscribe((s, prev) => {
    if (s.threads !== prev.threads) {
      take(s.threads, prev.threads.length > 0 || seen.size > 0);
    }
  });
};
