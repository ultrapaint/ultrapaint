import { create } from "zustand";

/**
 * Which key sends a chat message. `enter` sends on Enter and breaks the line on Shift+Enter;
 * `modEnter` breaks the line on Enter and sends on ⌘/Ctrl+Enter. A preference of this browser,
 * not of the project, so it is kept here rather than in the settings file.
 */
export type SendKey = "enter" | "modEnter";

const SEND_KEY = "ultrapaint:send-key";

interface SendKeyStore {
  sendKey: SendKey;
  setSendKey: (sendKey: SendKey) => void;
}

export const useSendKey = create<SendKeyStore>((set) => ({
  sendKey: localStorage.getItem(SEND_KEY) === "modEnter" ? "modEnter" : "enter",
  setSendKey: (sendKey) => {
    localStorage.setItem(SEND_KEY, sendKey);
    set({ sendKey });
  },
}));

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
