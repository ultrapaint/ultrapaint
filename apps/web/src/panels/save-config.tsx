import { RequestError } from "@ultrapaint/client-runtime/connection";
import type { PersistResult, Settings } from "@ultrapaint/contracts/settings";
import { CONFIG_FILE_NAME } from "@ultrapaint/contracts/settings";
import { CircleAlert, CircleCheck } from "lucide-react";
import type * as React from "react";
import { useState } from "react";
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
import { confirmDialog } from "../components/dialogs.tsx";
import { api } from "../state/connection.ts";
import { useProject } from "../state/project.ts";

const TRAILING_SLASH_RE = /\/+$/;

const close = () => useProject.getState().openSaveConfig(false);
const onOpenChange = (open: boolean) =>
  useProject.getState().openSaveConfig(open);

export const SaveConfigDialog = () => {
  const open = useProject((s) => s.saveConfigOpen);
  const settings = useProject((s) => s.settings);
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="sm:max-w-lg">
        {settings ? <SaveConfigForm settings={settings} /> : null}
      </DialogContent>
    </Dialog>
  );
};

/** Mounted with the dialog, so every open starts from the running settings. */
const SaveConfigForm = ({ settings }: { settings: Settings }) => {
  const repo = settings.repoPath.replace(TRAILING_SLASH_RE, "");
  const [configPath, setConfigPath] = useState(`${repo}/${CONFIG_FILE_NAME}`);
  const [problems, setProblems] = useState<readonly string[]>([]);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<PersistResult | null>(null);

  const persist = async (overwrite: boolean): Promise<void> => {
    try {
      const result = await api().request("settings.persist", {
        configPath,
        overwrite,
        settings,
      });
      setProblems(result.validation.problems);
      if (result.validation.ok) {
        setSaved(result);
        await useProject.getState().load();
      }
    } catch (error) {
      if (error instanceof RequestError && error.code === "conflict") {
        const replace = await confirmDialog({
          confirmLabel: "Replace",
          description: `${configPath} already exists.`,
          destructive: true,
          title: "Replace the existing file?",
        });
        if (replace) {
          await persist(true);
        }
        return;
      }
      setProblems([(error as Error).message]);
    }
  };

  const save = async () => {
    setBusy(true);
    await persist(false);
    setBusy(false);
  };
  const onConfigPath = (e: React.ChangeEvent<HTMLInputElement>) =>
    setConfigPath(e.target.value);

  if (saved) {
    return (
      <>
        <DialogHeader>
          <DialogTitle>Configuration saved</DialogTitle>
          <DialogDescription>
            Settings and agent threads are kept from now on. Commit the file to
            share the setup with your team.
          </DialogDescription>
        </DialogHeader>
        <Alert>
          <CircleCheck />
          <AlertTitle>{saved.configPath}</AlertTitle>
          <AlertDescription>
            Next time, start the tool with
            <code className="mt-1 block select-all rounded bg-muted px-2 py-1 font-mono text-foreground">
              {saved.command}
            </code>
          </AlertDescription>
        </Alert>
        <DialogFooter>
          <Button onClick={close}>Done</Button>
        </DialogFooter>
      </>
    );
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Save this configuration</DialogTitle>
        <DialogDescription>
          The tool was started without a configuration file, so nothing about
          this session is kept. Save one to keep the settings and the agent
          threads.
        </DialogDescription>
      </DialogHeader>
      <FieldGroup className="gap-4">
        <Field>
          <FieldLabel htmlFor="save-config-path">Configuration file</FieldLabel>
          <Input
            id="save-config-path"
            onChange={onConfigPath}
            value={configPath}
          />
          <FieldDescription>
            Meant to be committed: it holds no path of this machine. A file
            named {CONFIG_FILE_NAME} is found on its own when the tool is
            started inside the repository. Agent threads go to a git-ignored
            .ultrapaint directory next to it.
          </FieldDescription>
        </Field>
        <Field>
          <FieldLabel>Screens</FieldLabel>
          <Input readOnly value={`${repo}/${settings.designsDir}`} />
          <FieldDescription>
            Screens are files in the repository and are already saved there.
            Change the designs directory in the settings.
          </FieldDescription>
        </Field>
      </FieldGroup>
      {problems.length > 0 && (
        <Alert variant="destructive">
          <CircleAlert />
          <AlertTitle>The configuration could not be saved</AlertTitle>
          <AlertDescription>
            <ul className="list-disc pl-4">
              {problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}
      <DialogFooter>
        <Button onClick={close} variant="outline">
          Not now
        </Button>
        <Button disabled={busy} onClick={save}>
          {busy ? "Saving…" : "Save"}
        </Button>
      </DialogFooter>
    </>
  );
};
