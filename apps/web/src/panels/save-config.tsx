import { RequestError } from "@ultrapaint/client-runtime/connection";
import type { PersistResult, Settings } from "@ultrapaint/contracts/settings";
import { CONFIG_FILE_NAME } from "@ultrapaint/contracts/settings";
import { CircleAlert } from "lucide-react";
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
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { confirmDialog } from "../components/dialogs.tsx";
import { saveToFile } from "../lib/settings-actions.ts";
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
      <DialogContent className="gap-5 sm:max-w-md">
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
      const result = await saveToFile({ configPath, overwrite, settings });
      setProblems(result.validation.problems);
      if (result.validation.ok) {
        setSaved(result);
      }
    } catch (error) {
      if (error instanceof RequestError && error.code === "conflict") {
        const replace = await confirmDialog({
          confirmLabel: "Replace file",
          description: `${configPath} is overwritten with these settings.`,
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
            Settings and chats are kept from now on. Commit the file to share
            the setup.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-1.5">
          <span className="font-body-small text-muted-foreground">
            Start the editor next time with
          </span>
          <code className="select-all rounded-md bg-muted px-2.5 py-1.5 font-code">
            {saved.command}
          </code>
        </div>
        <DialogFooter>
          <Button onClick={close}>Done</Button>
        </DialogFooter>
      </>
    );
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Save configuration</DialogTitle>
        <DialogDescription>
          This run started without a configuration file, so its settings and
          chats aren’t kept. Pages are already saved in {settings.designsDir}.
        </DialogDescription>
      </DialogHeader>
      <Field>
        <FieldLabel htmlFor="save-config-path">Configuration file</FieldLabel>
        <Input
          className="font-code"
          id="save-config-path"
          onChange={onConfigPath}
          spellCheck={false}
          value={configPath}
        />
        <FieldDescription className="font-body-small">
          Commit it to share the setup. Chats go to a git-ignored .ultrapaint
          folder beside it.
        </FieldDescription>
      </Field>
      {problems.length > 0 && (
        <Alert variant="destructive">
          <CircleAlert />
          <AlertTitle>Couldn’t save the configuration</AlertTitle>
          <AlertDescription>
            {problems.length === 1 ? (
              <p>{problems[0]}</p>
            ) : (
              <ul className="list-disc pl-4">
                {problems.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            )}
          </AlertDescription>
        </Alert>
      )}
      <DialogFooter>
        <Button onClick={close} variant="outline">
          Not now
        </Button>
        <Button disabled={busy} onClick={save}>
          {busy ? <Spinner /> : null}
          {busy ? "Saving…" : "Save"}
        </Button>
      </DialogFooter>
    </>
  );
};
