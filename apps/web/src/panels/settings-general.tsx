/**
 * Settings › General: who you are to the tool, how it tells you an agent finished or asks, and
 * what of yours it keeps. Yours, in every project.
 */
import { useState } from "react";
import { OptionSelect } from "../components/option-select.tsx";
import { askToNotify } from "../lib/agent-notifications.ts";
import {
  DEFAULT_PREFERENCES,
  type Notifications,
  usePreferences,
} from "../state/preferences.ts";
import { Group, Row, RowMessage, rowField } from "./settings-group.tsx";
import { KeepFindingsRow, ProfileRow } from "./settings-profile.tsx";

const NOTIFICATIONS: readonly { label: string; value: Notifications }[] = [
  { label: "Off", value: "off" },
  { label: "Notification", value: "notification" },
  { label: "Sound", value: "sound" },
  { label: "Notification and sound", value: "both" },
];

const shows = (value: Notifications) =>
  value === "notification" || value === "both";

/**
 * How the editor tells of an agent that finished, stopped or asks while its window is away. A
 * notification asks the system's permission when it is picked; refused, the row says how to
 * allow it.
 */
const NotificationsRow = () => {
  const value = usePreferences((s) => s.notifications);
  const [blocked, setBlocked] = useState(
    () =>
      shows(value) &&
      typeof Notification !== "undefined" &&
      Notification.permission === "denied"
  );
  const pick = (next: string) => {
    const chosen = next as Notifications;
    usePreferences.getState().set("notifications", chosen);
    setBlocked(false);
    if (shows(chosen)) {
      askToNotify()
        .then((permission) => setBlocked(permission === "denied"))
        .catch(() => setBlocked(true));
    }
  };
  return (
    <Row
      description="When an agent finishes or asks you something while the window is in the background."
      htmlFor="settings-notifications"
      message={
        blocked ? (
          <RowMessage kind="notice">
            Notifications are blocked for Ultrapaint. Allow them in your
            system’s or browser’s settings, or pick Sound.
          </RowMessage>
        ) : null
      }
      onReset={
        value === DEFAULT_PREFERENCES.notifications
          ? undefined
          : () => pick(DEFAULT_PREFERENCES.notifications)
      }
      setting="notifications"
      title="Notifications"
    >
      <OptionSelect
        className={rowField}
        id="settings-notifications"
        onChange={pick}
        options={NOTIFICATIONS}
        value={value}
      />
    </Row>
  );
};

export const GeneralSection = () => (
  <>
    <Group>
      <ProfileRow />
      <NotificationsRow />
    </Group>
    <Group title="Your data">
      <KeepFindingsRow />
    </Group>
  </>
);
