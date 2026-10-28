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
import { Alert, AlertDescription } from "@/components/ui/alert";
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
  const suggestions = useId();

  useEffect(() => {
    projects
      .sshHosts()
      .then(setHosts)
      // No suggestions is no reason not to type a host.
      .catch(() => setHosts([]));
  }, [projects]);

  const add = async () => {
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
        <DialogTitle>Open a folder over SSH</DialogTitle>
        <DialogDescription>
          The editor runs on the other machine, with its Node.js and its agents,
          through your ssh, its configuration and your keys. The machine needs
          Node.js and the ultrapaint command.
        </DialogDescription>
      </DialogHeader>
      <FieldGroup className="gap-4">
        <Field>
          <FieldLabel htmlFor="remote-host">Host</FieldLabel>
          <Input
            autoFocus
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
          <FieldDescription>
            A Host of your ~/.ssh/config, or user@host. A password is not asked
            for: the key must be in your agent or need no passphrase.
          </FieldDescription>
        </Field>
        <Field>
          <FieldLabel htmlFor="remote-path">Folder</FieldLabel>
          <Input
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
            disabled={busy}
            id="remote-command"
            onChange={(e) => setCommand(e.target.value)}
            placeholder="ultrapaint"
            spellCheck={false}
            value={command}
          />
          <FieldDescription>
            What runs the editor there, in the folder, from a login shell.
            Another than ultrapaint, say node ~/ultrapaint/scripts/cli.ts.
          </FieldDescription>
        </Field>
      </FieldGroup>
      {problem ? (
        <Alert variant="destructive">
          <CircleAlert />
          <AlertDescription className="whitespace-pre-wrap">
            {problem}
          </AlertDescription>
        </Alert>
      ) : null}
      <DialogFooter>
        <Button
          disabled={busy}
          onClick={() => useRemoteProject.setState({ shown: false })}
          type="button"
          variant="ghost"
        >
          Cancel
        </Button>
        <Button
          disabled={busy || host.trim() === "" || path.trim() === ""}
          type="submit"
        >
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
      <DialogContent className="sm:max-w-lg">
        {/* Mounted with the dialog: each opening starts from a fresh form. */}
        {shown ? <Form projects={projects} /> : null}
      </DialogContent>
    </Dialog>
  );
};
