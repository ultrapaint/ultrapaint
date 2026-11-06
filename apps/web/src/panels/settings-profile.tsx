import { type KeyboardEvent, useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { api } from "../state/connection.ts";
import { useProject } from "../state/project.ts";
import { Row, RowMessage, rowField } from "./settings-group.tsx";

/**
 * Where the name is between the field and the user's own directory: saving and saved under the
 * field, a failure under the row.
 */
type Status =
  | { kind: "loading" }
  | { kind: "ready" }
  | { kind: "saving" }
  | { kind: "saved" }
  | { kind: "failed"; message: string };

const statusLine = (status: Status) => {
  switch (status.kind) {
    case "saving":
      return "Saving…";
    case "saved":
      return "Saved";
    default:
      return null;
  }
};

/**
 * What the name does, and what stands in for it when the field is left empty: git's name, which
 * the field shows as its placeholder (the person's choice), so the words only say where it is from.
 */
const describe = (gitName: string | undefined) =>
  gitName
    ? "Signs your comments. Left empty, your name from git is used."
    : "Signs your comments and draws your avatar.";

/**
 * Who the user is to the tool. The name is the user's, not the project's: it is saved as soon as
 * the field is left, into the user's own directory, and is the same in every project. Under the
 * field, what became of it: saving or saved; under the row, why it could not be read or saved.
 */
export const ProfileRow = () => {
  const gitName = useProject((s) => s.info.gitUser?.name);
  const [name, setName] = useState("");
  const [savedName, setSavedName] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "loading" });
  useEffect(() => {
    api()
      .request("profile.get", undefined)
      .then((profile) => {
        setName(profile.displayName ?? "");
        setSavedName(profile.displayName ?? "");
        setStatus({ kind: "ready" });
      })
      // The field stays usable: a name typed in replaces whatever could not be read.
      .catch((error: Error) =>
        setStatus({
          kind: "failed",
          message: `Couldn’t read your name (${error.message}). One typed here replaces it.`,
        })
      );
  }, []);
  const save = () => {
    if (status.kind === "loading" || name === savedName) {
      return;
    }
    setStatus({ kind: "saving" });
    api()
      .request("profile.set", { displayName: name })
      .then((profile) => {
        setName(profile.displayName ?? "");
        setSavedName(profile.displayName ?? "");
        setStatus({ kind: "saved" });
      })
      .catch((error: Error) =>
        setStatus({
          kind: "failed",
          message: `Couldn’t save your name (${error.message}). Leave the field to try again.`,
        })
      );
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      save();
    }
  };
  const line = statusLine(status);
  return (
    <Row
      description={describe(gitName)}
      htmlFor="settings-display-name"
      message={
        status.kind === "failed" ? (
          <RowMessage id="settings-display-name-status" kind="error">
            {status.message}
          </RowMessage>
        ) : null
      }
      title="Display name"
    >
      <Input
        aria-describedby={
          line || status.kind === "failed"
            ? "settings-display-name-status"
            : undefined
        }
        aria-invalid={status.kind === "failed" || undefined}
        className={rowField}
        disabled={status.kind === "loading"}
        id="settings-display-name"
        onBlur={save}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={status.kind === "loading" ? "Loading…" : gitName}
        value={name}
      />
      {line ? (
        <p
          aria-live="polite"
          className="@xl:w-52 font-small text-muted-foreground"
          id="settings-display-name-status"
        >
          {line}
        </p>
      ) : null}
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
      description="Saves what review models find, in every project, to ~/.ultrapaint/findings, so the design skill can learn from it."
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
