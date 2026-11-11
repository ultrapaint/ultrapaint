import { type KeyboardEvent, useEffect, useRef, useState } from "react";
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
 * Whether review models' findings are kept, in every project (ADR 0066): the log is in the user's
 * own directory, so the choice is the user's, saved at once with the rest of the profile.
 */
export const KeepFindingsRow = () => {
  const [kept, setKept] = useState<boolean | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  useEffect(() => {
    api()
      .request("profile.get", undefined)
      .then((profile) => setKept(profile.keepFindings === true))
      .catch((error: Error) => {
        setKept(false);
        setFailed(`Couldn’t read the setting (${error.message}).`);
      });
  }, []);
  const change = (next: boolean) => {
    setKept(next);
    setFailed(null);
    api()
      .request("profile.set", { keepFindings: next })
      .then((profile) => setKept(profile.keepFindings === true))
      .catch((error: Error) => {
        setKept(!next);
        setFailed(`Couldn’t save it (${error.message}). Try again.`);
      });
  };
  return (
    <Row
      description="Saves review findings to ~/.ultrapaint/findings, for the design skill."
      htmlFor="settings-keep-findings"
      message={failed ? <RowMessage kind="error">{failed}</RowMessage> : null}
      title="Keep findings"
    >
      <Switch
        checked={kept === true}
        disabled={kept === null}
        id="settings-keep-findings"
        onCheckedChange={change}
      />
    </Row>
  );
};
