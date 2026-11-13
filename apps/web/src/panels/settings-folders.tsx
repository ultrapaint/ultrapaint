/**
 * Where Ultrapaint keeps what isn't the project's code (ADR 0091): the person's folder, the same
 * in every project; in the desktop app, the folder new projects are made in; and the project's
 * own data, when it has a folder of its own. The desktop app opens each in the file manager and
 * moves or changes them; in a browser the person's folder moves only by how the server is
 * started, which the row says.
 */

import { Check, Copy } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { IconButton } from "../components/icon-button.tsx";
import { platform, type ShellFolders } from "../platform.ts";
import { reportError, useProject } from "../state/project.ts";
import { Group, Row, RowMessage } from "./settings-group.tsx";

/** A path as the row's control: the text filling the column, its buttons at the far right. */
const PathLine = ({
  children,
  path,
}: {
  children?: ReactNode;
  path: string;
}) => (
  <div className="flex min-w-0 items-start gap-2">
    {/* The line is the buttons' height, so a path that wraps starts level with them. */}
    <code className="min-w-0 flex-1 select-text break-all py-1 font-code">
      {path}
    </code>
    {children ? (
      <div className="flex shrink-0 items-center gap-2">{children}</div>
    ) : null}
  </div>
);

/** Copies a path, saying so for a moment. */
const CopyPath = ({ path }: { path: string }) => {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard
      .writeText(path)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      })
      .catch(reportError);
  };
  return (
    <IconButton onClick={copy} tooltip="Copy the path">
      {copied ? <Check /> : <Copy />}
    </IconButton>
  );
};

/** Why something the shell was asked failed, as its message says. */
const messageOf = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

/** Which row a failure is said under. */
type RowId = "user" | "newProjects" | "project";

/**
 * Settings › About's folders (ADR 0091): Your folder, New projects (desktop app) and This
 * project’s data (when the project keeps its own), each a path and what can be done with it.
 */
export const FoldersGroup = () => {
  const served = useProject((s) => s.info.folders);
  const shell = platform().folders;
  const [current, setCurrent] = useState<ShellFolders | null>(null);
  const [moving, setMoving] = useState(false);
  const [problem, setProblem] = useState<{
    message: string;
    row: RowId;
  } | null>(null);

  useEffect(() => {
    shell
      ?.current()
      .then(setCurrent)
      .catch((error: unknown) =>
        setProblem({
          message: `Couldn’t read your folders (${messageOf(error)}).`,
          row: "user",
        })
      );
  }, [shell]);

  // The app's own word for it where there is an app: the server it started was given it.
  const user = current?.user ?? served?.user;
  const said = (row: RowId) =>
    problem?.row === row ? (
      <RowMessage kind="error">
        <p>{problem.message}</p>
      </RowMessage>
    ) : null;

  const open = (row: RowId, folder: string) => {
    setProblem(null);
    shell
      ?.open(folder)
      .catch((error: unknown) =>
        setProblem({ message: messageOf(error), row })
      );
  };

  const move = () => {
    if (!shell) {
      return;
    }
    setProblem(null);
    setMoving(true);
    // Moved with a project open, its server starts again and the editor comes back here.
    shell
      .moveUser()
      .then((outcome) => {
        if (outcome.problem) {
          setProblem({ message: outcome.problem, row: "user" });
        }
        const moved = outcome.user;
        if (moved) {
          setCurrent((was) => (was ? { ...was, user: moved } : was));
        }
      })
      .catch((error: unknown) =>
        setProblem({
          message: `Couldn’t move your folder (${messageOf(error)}). Try again.`,
          row: "user",
        })
      )
      .finally(() => setMoving(false));
  };

  const changeNewProjects = () => {
    if (!shell) {
      return;
    }
    setProblem(null);
    shell
      .setNewProjects()
      .then((picked) => {
        if (picked) {
          setCurrent((was) => (was ? { ...was, newProjects: picked } : was));
        }
      })
      .catch((error: unknown) =>
        setProblem({
          message: `Couldn’t change the folder (${messageOf(error)}). Try again.`,
          row: "newProjects",
        })
      );
  };

  return (
    <Group title="Folders">
      {user ? (
        <Row
          description={
            shell ? (
              "Your name, review findings and chat preferences, in every project."
            ) : (
              <>
                Your name, review findings and chat preferences, in every
                project. To move it, start Ultrapaint with{" "}
                <code className="font-code">ULTRAPAINT_USER_DIR</code> set.
              </>
            )
          }
          layout="field"
          message={said("user")}
          title="Your folder"
        >
          <PathLine path={user}>
            {shell ? (
              <>
                <Button onClick={() => open("user", user)} variant="outline">
                  Open
                </Button>
                <Button disabled={moving} onClick={move} variant="outline">
                  {moving ? <Spinner /> : null}
                  {moving ? "Moving…" : "Move…"}
                </Button>
              </>
            ) : (
              <CopyPath path={user} />
            )}
          </PathLine>
        </Row>
      ) : null}
      {shell && current ? (
        <Row
          description="Where the start screen makes a new project."
          layout="field"
          message={said("newProjects")}
          title="New projects"
        >
          <PathLine path={current.newProjects}>
            <Button onClick={changeNewProjects} variant="outline">
              Change…
            </Button>
          </PathLine>
        </Row>
      ) : null}
      {served?.project ? (
        <Row
          description="Its chats, design history and caches."
          layout="field"
          message={said("project")}
          title="This project’s data"
        >
          <PathLine path={served.project}>
            {shell ? (
              <Button
                onClick={() => {
                  if (served.project) {
                    open("project", served.project);
                  }
                }}
                variant="outline"
              >
                Open
              </Button>
            ) : null}
          </PathLine>
        </Row>
      ) : null}
    </Group>
  );
};
