/**
 * A folder on another machine (PLAN-desktop D12): a host as `ssh` takes it, with the aliases of
 * the user's SSH configuration suggested, the folder there, and the command that runs the server
 * there when it is not `ultrapaint` on the login shell's PATH. Only a shell that reaches other
 * machines has it (the desktop app); it opens from the welcome page and from the project
 * switcher.
 */
import { CircleAlert } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { create } from "zustand";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { type ProjectSwitcher, platform } from "../platform.ts";

const useRemoteProject = create<{ shown: boolean }>(() => ({ shown: false }));

/** Opens the dialog, where the shell reaches other machines. */
export const openRemoteProject = () =>
  useRemoteProject.setState({ shown: true });

/** Whether the shell opens folders on other machines. */
export const canAddRemoteProjects = () => platform().projects !== undefined;

const messageOf = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

const Form = ({ projects }: { projects: ProjectSwitcher }) => {
  const [host, setHost] = useState("");
  const [path, setPath] = useState("");
  const [command, setCommand] = useState("");
  const [hosts, setHosts] = useState<readonly string[]>([]);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  // Opened with a field left empty: the empty ones say so.
  const [tried, setTried] = useState(false);
  const suggestions = useId();

  useEffect(() => {
    projects
      .sshHosts()
      .then(setHosts)
      // No suggestions is no reason not to type a host.
      .catch(() => setHosts([]));
  }, [projects]);

  const add = async () => {
    if (host.trim() === "" || path.trim() === "") {
      setTried(true);
      return;
    }
    setBusy(true);
    setProblem(null);
    try {
      const result = await projects.addRemote({
        command: command.trim(),
        host,
        path,
      });
      if (result.problem) {
        setProblem(result.problem);
      }
    } catch (error) {
      setProblem(messageOf(error));
    }
    // Opened, the window shows its editor in place of this one; not opened, the welcome page
    // says why.
    setBusy(false);
  };

  return (
    <form
      className="contents"
      onSubmit={(event) => {
        event.preventDefault();
        add();
      }}
    >
      <DialogHeader>
        <DialogTitle>Open over SSH</DialogTitle>
        <DialogDescription>
          The editor runs on the other machine, with its Node.js and agents,
          through your ssh setup and keys.
        </DialogDescription>
      </DialogHeader>
      <FieldGroup className="gap-4">
        <Field>
          <FieldLabel htmlFor="remote-host">Host</FieldLabel>
          <Input
            aria-invalid={tried && host.trim() === ""}
            autoFocus
            className="font-code"
            disabled={busy}
            id="remote-host"
            list={suggestions}
            onChange={(e) => setHost(e.target.value)}
            placeholder="devbox, or user@host:port"
            spellCheck={false}
            value={host}
          />
          <datalist id={suggestions}>
            {hosts.map((alias) => (
              <option key={alias} value={alias} />
            ))}
          </datalist>
          <FieldDescription className="font-body-small">
            A Host from ~/.ssh/config, or user@host. Your key must be in your
            ssh agent or have no passphrase.
          </FieldDescription>
        </Field>
        <Field>
          <FieldLabel htmlFor="remote-path">Folder</FieldLabel>
          <Input
            aria-invalid={tried && path.trim() === ""}
            className="font-code"
            disabled={busy}
            id="remote-path"
            onChange={(e) => setPath(e.target.value)}
            placeholder="~/code/shop"
            spellCheck={false}
            value={path}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="remote-command">Command</FieldLabel>
          <Input
            className="font-code"
            disabled={busy}
            id="remote-command"
            onChange={(e) => setCommand(e.target.value)}
            placeholder="ultrapaint"
            spellCheck={false}
            value={command}
          />
          <FieldDescription className="font-body-small">
            What starts the editor there, when it isn’t ultrapaint on the PATH.
          </FieldDescription>
        </Field>
      </FieldGroup>
      {problem ? (
        <Alert variant="destructive">
          <CircleAlert />
          <AlertTitle>Couldn’t open the folder</AlertTitle>
          <AlertDescription className="max-h-40 overflow-y-auto whitespace-pre-wrap">
            {problem}
          </AlertDescription>
        </Alert>
      ) : null}
      <DialogFooter>
        <Button
          disabled={busy}
          onClick={() => useRemoteProject.setState({ shown: false })}
          type="button"
          variant="outline"
        >
          Cancel
        </Button>
        <Button disabled={busy} type="submit">
          {busy ? <Spinner /> : null}
          {busy ? "Connecting…" : "Open"}
        </Button>
      </DialogFooter>
    </form>
  );
};

/** The dialog, where the shell reaches other machines; nothing in a browser. */
export const RemoteProjectDialog = () => {
  const shown = useRemoteProject((s) => s.shown);
  const { projects } = platform();
  if (!projects) {
    return null;
  }
  return (
    <Dialog
      onOpenChange={(open) => {
        if (!open) {
          useRemoteProject.setState({ shown: false });
        }
      }}
      open={shown}
    >
      <DialogContent className="gap-5 sm:max-w-md">
        {/* Mounted with the dialog: each opening starts from a fresh form. */}
        {shown ? <Form projects={projects} /> : null}
      </DialogContent>
    </Dialog>
  );
};
