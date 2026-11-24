import type { FollowUp } from "@ultrapaint/contracts/threads";
import { create } from "zustand";

/**
 * Which key sends a chat message. `enter` sends on Enter and breaks the line on Shift+Enter;
 * `modEnter` breaks the line on Enter and sends on ⌘/Ctrl+Enter. A preference of this browser,
 * not of the project, so it is kept here rather than in the settings file.
 */
export type SendKey = "enter" | "modEnter";

const SEND_KEY = "ultrapaint:send-key";
const FOLLOW_UP = "ultrapaint:follow-up";

interface SendKeyStore {
  /**
   * What the send key does while the agent works (ADR 0137): `steer` sends the prompt into the
   * turn, `queue` waits for the turn's end; the other send key does the other.
   */
  followUp: FollowUp;
  sendKey: SendKey;
  setFollowUp: (followUp: FollowUp) => void;
  setSendKey: (sendKey: SendKey) => void;
}

export const useSendKey = create<SendKeyStore>((set) => ({
  followUp: localStorage.getItem(FOLLOW_UP) === "queue" ? "queue" : "steer",
  sendKey: localStorage.getItem(SEND_KEY) === "modEnter" ? "modEnter" : "enter",
  setFollowUp: (followUp) => {
    localStorage.setItem(FOLLOW_UP, followUp);
    set({ followUp });
  },
  setSendKey: (sendKey) => {
    localStorage.setItem(SEND_KEY, sendKey);
    set({ sendKey });
  },
}));

/** The follow-up the send key does not do: what the other send key does. */
export const otherFollowUp = (followUp: FollowUp): FollowUp =>
  followUp === "steer" ? "queue" : "steer";

/** The chord of the other follow-up: ⌘↵ where Enter sends, ⌘⇧↵ where ⌘↵ does. */
export const alternateChord = (sendKey: SendKey) =>
  sendKey === "enter" ? "mod+enter" : "mod+shift+enter";

/** Whether a key press in the composer sends the message under the chosen key. */
export const isSendKey = (
  e: {
    ctrlKey: boolean;
    key: string;
    metaKey: boolean;
    nativeEvent: { isComposing: boolean };
    shiftKey: boolean;
  },
  sendKey: SendKey
) => {
  // Enter that confirms an input method's composition is not a send.
  if (e.key !== "Enter" || e.nativeEvent.isComposing) {
    return false;
  }
  const mod = e.metaKey || e.ctrlKey;
  // ⌘/Ctrl+Enter sends under either choice, so the habit still works.
  return mod || (sendKey === "enter" && !e.shiftKey);
};

/**
 * Whether a key press in the composer sends the prompt the other way while the agent works
 * (ADR 0137): ⌘/Ctrl+Enter where Enter sends, ⌘/Ctrl+Shift+Enter where ⌘/Ctrl+Enter does.
 */
export const isAlternateSendKey = (
  e: {
    ctrlKey: boolean;
    key: string;
    metaKey: boolean;
    nativeEvent: { isComposing: boolean };
    shiftKey: boolean;
  },
  sendKey: SendKey
) =>
  e.key === "Enter" &&
  !e.nativeEvent.isComposing &&
  (e.metaKey || e.ctrlKey) &&
  e.shiftKey === (sendKey === "modEnter");
