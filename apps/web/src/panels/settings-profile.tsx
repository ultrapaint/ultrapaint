import type { UserProfile } from "@ultrapaint/contracts/settings";
import type { SandboxStatus } from "@ultrapaint/contracts/threads";
import {
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/cn";
import { useAutosave } from "../lib/autosave.ts";
import { api } from "../state/connection.ts";
import { useProject } from "../state/project.ts";
import { Row, RowMessage, rowField } from "./settings-group.tsx";

/** Where the name is between the field and the user's own directory. */
type Status =
  | { kind: "loading" }
  | { kind: "ready" }
  | { kind: "unread"; message: string }
  | { kind: "failed"; message: string };

/**
 * What the name does, and, while the field is empty, what stands in for it: git's name, which
 * the field shows as its placeholder (the person's choice), so the words only say where it is from.
 */
const describe = (gitName: string | undefined, typed: boolean) =>
  gitName && !typed
    ? "Signs your comments. Left empty, your name from git is used."
    : "Signs your comments and draws your avatar.";

/**
 * Who the user is to the tool. The name is the user's, not the project's: kept in the user's own
 * directory, the same in every project, and saved as it is typed (ADR 0079), after a pause or when
 * the field is left. A save never writes into the field; under the row, why the name could not be
 * read (with Try again) or saved.
 */
export const ProfileRow = () => {
  const gitName = useProject((s) => s.info.gitUser?.name);
  const [name, setName] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "loading" });
  /** The name the user's directory holds, as the server trims it. */
  const savedName = useRef("");
  const read = () =>
    api()
      .request("profile.get", undefined)
      .then((profile) => {
        setName(profile.displayName ?? "");
        savedName.current = profile.displayName ?? "";
        setStatus({ kind: "ready" });
      })
      // The field stays usable: a name typed in replaces whatever could not be read.
      .catch((error: Error) =>
        setStatus({
          kind: "unread",
          message: `Couldn’t read your name (${error.message}).`,
        })
      );
  // biome-ignore lint/correctness/useExhaustiveDependencies: read once, as the row opens
  useEffect(() => {
    read();
  }, []);
  const readAgain = () => {
    setStatus({ kind: "loading" });
    read();
  };
  const saver = useAutosave(async (typed: string) => {
    const displayName = typed.trim();
    if (displayName === savedName.current) {
      return;
    }
    try {
      const profile = await api().request("profile.set", { displayName });
      savedName.current = profile.displayName ?? "";
      setStatus({ kind: "ready" });
    } catch (error) {
      const why = (error as Error).message;
      setStatus({
        kind: "failed",
        message: `Couldn’t save your name (${why}). Leave the field to try again.`,
      });
      // Saved as the dialog closed: the row is gone, so a toast says it.
      if (!useProject.getState().settingsOpen) {
        toast.error(`Couldn’t save your name (${why}).`);
      }
    }
  });
  // Closing, by the close button or Escape, saves what was typed.
  const open = useProject((s) => s.settingsOpen);
  useEffect(() => {
    if (!open) {
      saver.flush();
    }
  }, [open, saver]);
  const leave = () => {
    const trimmed = name.trim();
    setName(trimmed);
    saver.now(trimmed);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      leave();
    }
  };
  const problem =
    status.kind === "failed" || status.kind === "unread" ? status : null;
  return (
    <Row
      description={describe(gitName, name.trim() !== "")}
      htmlFor="settings-display-name"
      message={
        problem ? (
          <RowMessage id="settings-display-name-status" kind="error">
            <p>{problem.message}</p>
            {problem.kind === "unread" ? (
              <Button onClick={readAgain} size="sm" variant="outline">
                Try again
              </Button>
            ) : null}
          </RowMessage>
        ) : null
      }
      setting="display-name"
      title="Display name"
    >
      {status.kind === "loading" ? (
        <div
          aria-hidden
          className={cn("h-7 w-full rounded-md bg-foreground/10", rowField)}
        />
      ) : (
        <Input
          aria-describedby={
            problem ? "settings-display-name-status" : undefined
          }
          aria-invalid={problem?.kind === "failed" || undefined}
          className={rowField}
          id="settings-display-name"
          onBlur={leave}
          onChange={(e) => {
            setName(e.target.value);
            saver.soon(e.target.value);
          }}
          onKeyDown={onKeyDown}
          placeholder={gitName}
          value={name}
        />
      )}
    </Row>
  );
};

/**
 * A switch over one of the person's own settings, in every project, saved at once with the rest
 * of the profile: `read` says it from the profile, `write` is what saves a change. While
 * `unavailable` says why the setting can't take effect here, the switch shows it off and waits,
 * the person's choice kept for when it can.
 */
const ProfileSwitchRow = ({
  description,
  id,
  read,
  setting,
  title,
  unavailable,
  write,
}: {
  description: string;
  id: string;
  read: (profile: UserProfile) => boolean;
  setting: string;
  title: string;
  unavailable?: ReactNode;
  write: (on: boolean) => UserProfile;
}) => {
  const [on, setOn] = useState<boolean | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  useEffect(() => {
    api()
      .request("profile.get", undefined)
      .then((profile) => setOn(read(profile)))
      .catch((error: Error) => {
        setOn(read({}));
        setFailed(`Couldn’t read the setting (${error.message}).`);
      });
  }, [read]);
  const change = (next: boolean) => {
    setOn(next);
    setFailed(null);
    api()
      .request("profile.set", write(next))
      .then((profile) => setOn(read(profile)))
      .catch((error: Error) => {
        setOn(!next);
        setFailed(`Couldn’t save it (${error.message}). Try again.`);
      });
  };
  let rowMessage: ReactNode = null;
  if (failed) {
    rowMessage = <RowMessage kind="error">{failed}</RowMessage>;
  } else if (unavailable) {
    rowMessage = <RowMessage kind="notice">{unavailable}</RowMessage>;
  }
  return (
    <Row
      description={description}
      htmlFor={id}
      message={rowMessage}
      setting={setting}
      title={title}
    >
      <Switch
        checked={on === true && !unavailable}
        disabled={on === null || Boolean(unavailable)}
        id={id}
        onCheckedChange={change}
      />
    </Row>
  );
};

const keepsFindings = (profile: UserProfile) => profile.keepFindings === true;
const writeKeepFindings = (on: boolean): UserProfile => ({
  keepFindings: on,
});

/**
 * Whether review models' findings are kept, in every project (ADR 0066): the log is in the user's
 * own directory, so the choice is the user's.
 */
export const KeepFindingsRow = () => (
  <ProfileSwitchRow
    description="Saves what review models find, so the design skill can learn from it."
    id="settings-keep-findings"
    read={keepsFindings}
    setting="keep-findings"
    title="Keep review findings"
    write={writeKeepFindings}
  />
);

const sandboxed = (profile: UserProfile) => profile.sandbox !== false;
const writeSandbox = (on: boolean): UserProfile => ({ sandbox: on });

/**
 * Why agents run unconfined on this computer whatever the switch says, or nothing when they
 * can be confined (ADR 0119). The server finds out once, as it starts.
 */
export const sandboxUnavailable = (status: SandboxStatus): ReactNode => {
  if (status.available) {
    return null;
  }
  const lead =
    "This computer can’t run agents in a sandbox, so they run without one";
  if (status.problem) {
    return `${lead}: ${status.problem}. Once it can start, restart Ultrapaint.`;
  }
  if (status.platform === "linux") {
    return (
      <>
        {lead}. Install bubblewrap (<code className="font-code">bwrap</code>)
        and restart Ultrapaint.
      </>
    );
  }
  return `${lead}: Ultrapaint has a sandbox for macOS and Linux only.`;
};

/**
 * Whether the agents the editor starts on this computer run in its sandbox (ADR 0119): the
 * person's, never a project's, and on until they turn it off. Where this computer has none,
 * it says so and why.
 */
export const SandboxRow = () => {
  const [status, setStatus] = useState<SandboxStatus | null>(null);
  useEffect(() => {
    api()
      .request("agents.sandbox", undefined)
      .then(setStatus)
      // Not knowing, the switch says what the person chose.
      .catch(() => setStatus(null));
  }, []);
  return (
    <ProfileSwitchRow
      description="Agents reach only this project, their own files and the tools they need. Off, they can read and change anything you can. Agents already running stay as they started."
      id="settings-sandbox"
      read={sandboxed}
      setting="sandbox"
      title="Run agents in a sandbox"
      unavailable={status ? sandboxUnavailable(status) : null}
      write={writeSandbox}
    />
  );
};
