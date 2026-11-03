import { type KeyboardEvent, useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { api } from "../state/connection.ts";
import { reportError, useProject } from "../state/project.ts";
import { Row } from "./settings-group.tsx";

/**
 * Who the user is to the tool. The name is the user's, not the project's: it is saved as soon as
 * the field is left, into the user's own directory, and is the same in every project.
 */
export const ProfileRow = () => {
  const gitName = useProject((s) => s.info.gitUser?.name);
  const [name, setName] = useState<string | null>(null);
  useEffect(() => {
    api()
      .request("profile.get", undefined)
      .then((profile) => setName(profile.displayName ?? ""))
      .catch(reportError);
  }, []);
  const save = () => {
    if (name === null) {
      return;
    }
    api()
      .request("profile.set", { displayName: name })
      .then((profile) => setName(profile.displayName ?? ""))
      .catch(reportError);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      save();
    }
  };
  return (
    <Row
      description={
        gitName
          ? `Signs your comments where git has no name; here git signs them ${gitName}.`
          : "Signs your comments and draws your avatar."
      }
      htmlFor="settings-display-name"
      layout="field"
      title="Display name"
    >
      <Input
        disabled={name === null}
        id="settings-display-name"
        onBlur={save}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={gitName ?? "Your name"}
        value={name ?? ""}
      />
    </Row>
  );
};
