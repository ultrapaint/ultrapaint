import { cn } from "cn";
import { type KeyboardEvent, useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { api } from "../state/connection.ts";
import { useProject } from "../state/project.ts";
import { Row, rowField } from "./settings-group.tsx";

/** Where the name is between the field and the user's own directory, said under the field. */
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
    case "failed":
      return status.message;
    default:
      return null;
  }
};

/**
 * Who the user is to the tool. The name is the user's, not the project's: it is saved as soon as
 * the field is left, into the user's own directory, and is the same in every project. Under the
 * field, what became of it: saving, saved, or why it could not be read or saved.
 */
export const ProfileRow = () => {
  const hasGitName = useProject((s) => Boolean(s.info.gitUser?.name));
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
      description={
        hasGitName
          ? "Signs your comments. Empty, your git name does."
          : "Signs your comments and draws your avatar."
      }
      htmlFor="settings-display-name"
      title="Display name"
    >
      <Input
        aria-describedby={line ? "settings-display-name-status" : undefined}
        className={rowField}
        disabled={status.kind === "loading"}
        id="settings-display-name"
        onBlur={save}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={status.kind === "loading" ? "Loading…" : "Your name"}
        value={name}
      />
      {line ? (
        <p
          aria-live="polite"
          className={cn(
            "@xl:w-52 font-small",
            status.kind === "failed"
              ? "text-destructive"
              : "text-muted-foreground"
          )}
          id="settings-display-name-status"
        >
          {line}
        </p>
      ) : null}
    </Row>
  );
};
