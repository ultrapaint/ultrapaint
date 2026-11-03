import {
  DEFAULT_DESIGNS_DIR,
  defaultSettings,
  type Settings,
} from "@ultrapaint/contracts/settings";
import {
  describeSuggestions,
  hostCssFor,
  type SetupSuggestions,
  stylesheetOf,
} from "@ultrapaint/contracts/setup";
import { CircleAlert, FolderGit2, FolderSearch, Rocket } from "lucide-react";
import type * as React from "react";
import { useEffect, useState } from "react";
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
import { startApplication } from "../lib/scaffold.ts";
import { detect, setUpDesigns } from "../lib/settings-actions.ts";
import { showSetup as showSync } from "../state/design-system-setup.ts";
import { useProject } from "../state/project.ts";
import { useSetup } from "../state/setup.ts";
import { PanelEmpty } from "./panel.tsx";

const close = () => useSetup.getState().close();
const onOpenChange = (open: boolean) => {
  if (!open) {
    close();
  }
};
const configureFolders = () => {
  close();
  useProject.getState().openSettings(true, "repository");
};
/** The Sync view, which works out what the repository needs (ADR 0025). */
const openSync = () => {
  close();
  showSync();
};
export const openSetup = () => useSetup.getState().open();

/** A repository with no application: one is started, then the Sync view takes over. */
const startNew = async (found: SetupSuggestions, repoPath: string) => {
  // A repository with no package.json at all gets the application at its root.
  if (
    await startApplication({ beside: found.rootManifest ?? false, repoPath })
  ) {
    openSync();
  }
};

/**
 * Asked at the first edit when no project is open: set the repository up. The editor is usable
 * without it; only changing a design needs it.
 */
export const SetupDialog = () => {
  const shown = useSetup((s) => s.shown);
  return (
    <Dialog onOpenChange={onOpenChange} open={shown}>
      <DialogContent className="gap-5 sm:max-w-md">
        <ConfigureForm />
      </DialogContent>
    </Dialog>
  );
};

/** Mounted with the dialog, so every open reads the repository again. */
const ConfigureForm = () => {
  const saved = useProject((s) => s.settings);
  const storage = useProject((s) => s.info.storage);
  const repoPath = saved?.repoPath ?? storage.defaultRepoPath ?? "";
  const [draft, setDraft] = useState<Settings | null>(saved);
  const [found, setFound] = useState<SetupSuggestions | null>(null);
  const [problems, setProblems] = useState<readonly string[]>([]);
  const [busy, setBusy] = useState(false);

  // Settings that exist but could not be opened are shown as they are; otherwise detect.
  useEffect(() => {
    if (saved || !repoPath) {
      return;
    }
    detect(repoPath)
      .then((detection) => {
        setFound(detection.found);
        setDraft(detection.onto(defaultSettings(repoPath)));
      })
      .catch((error: Error) => {
        setProblems([error.message]);
        setDraft(defaultSettings(repoPath));
      });
  }, [saved, repoPath]);

  // The stylesheet as the repository names it: the settings name it from the designs directory.
  const [stylesheet, setStylesheet] = useState<string | null>(null);
  const shownStylesheet =
    stylesheet ??
    (draft?.hostCss[0] === undefined
      ? ""
      : stylesheetOf(draft.designsDir, draft.hostCss[0]));

  const onDesignsDir = (e: React.ChangeEvent<HTMLInputElement>) => {
    const designsDir = e.target.value;
    setStylesheet(shownStylesheet);
    setDraft((d) => (d ? { ...d, designsDir } : d));
  };

  const setUp = async () => {
    if (!draft) {
      return;
    }
    setBusy(true);
    const css = shownStylesheet.trim();
    try {
      const refused = await setUpDesigns({
        ...draft,
        hostCss: css ? [hostCssFor(draft.designsDir, css)] : [],
      });
      setProblems(refused);
      if (refused.length === 0) {
        openSync();
      }
    } catch (error) {
      setProblems([(error as Error).message]);
    }
    setBusy(false);
  };

  if (!repoPath) {
    return (
      <>
        <DialogHeader>
          <DialogTitle>Set up a repository</DialogTitle>
          <DialogDescription>
            Choose the folder to design in, and where its pages are saved.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button onClick={close} variant="outline">
            Cancel
          </Button>
          <Button onClick={configureFolders}>Open settings</Button>
        </DialogFooter>
      </>
    );
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Set up this repository</DialogTitle>
        <DialogDescription>
          Pages are saved in the repository, beside your code. Sync then brings
          in the design system.
        </DialogDescription>
      </DialogHeader>
      {found ? (
        <Alert>
          <FolderSearch />
          <AlertDescription>
            {describeSuggestions(found)}
            {found.anchors.length === 0 ? (
              <Button
                className="mt-2"
                disabled={busy}
                onClick={() => startNew(found, repoPath)}
                size="sm"
                variant="outline"
              >
                <Rocket />
                Start a new application…
              </Button>
            ) : null}
          </AlertDescription>
        </Alert>
      ) : null}
      <FieldGroup className="gap-4">
        <Field className="gap-1">
          <FieldLabel>Repository</FieldLabel>
          <p
            className="truncate font-code text-muted-foreground"
            title={repoPath}
          >
            {repoPath}
          </p>
        </Field>
        <Field>
          <FieldLabel htmlFor="setup-designs">Designs directory</FieldLabel>
          <Input
            className="font-code"
            disabled={!draft}
            id="setup-designs"
            onChange={onDesignsDir}
            placeholder={DEFAULT_DESIGNS_DIR}
            spellCheck={false}
            value={draft?.designsDir ?? ""}
          />
          <FieldDescription className="font-small">
            Relative to the repository; made if it is missing.
          </FieldDescription>
        </Field>
        <Field>
          <FieldLabel htmlFor="setup-stylesheet">Stylesheet</FieldLabel>
          <Input
            className="font-code"
            disabled={!draft}
            id="setup-stylesheet"
            onChange={(e) => setStylesheet(e.target.value)}
            placeholder="src/index.css"
            spellCheck={false}
            value={shownStylesheet}
          />
          <FieldDescription className="font-small">
            Your app’s theme, relative to the repository. Empty if there is none
            yet.
          </FieldDescription>
        </Field>
      </FieldGroup>
      {problems.length > 0 && (
        <Alert variant="destructive">
          <CircleAlert />
          <AlertTitle>Couldn’t set up the repository</AlertTitle>
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
      <DialogFooter className="sm:justify-between">
        <Button onClick={configureFolders} variant="ghost">
          All settings…
        </Button>
        <div className="flex flex-col-reverse gap-2 sm:flex-row">
          <Button onClick={close} variant="outline">
            Cancel
          </Button>
          <Button disabled={busy || !draft} onClick={setUp}>
            {busy ? <Spinner /> : null}
            {busy ? "Setting up…" : "Set up and sync"}
          </Button>
        </div>
      </DialogFooter>
    </>
  );
};

/** What a panel shows while no repository is set up. */
export const SetupEmpty = () => (
  <PanelEmpty
    action={
      <Button onClick={openSetup} size="sm" variant="outline">
        Set up repository
      </Button>
    }
    icon={<FolderGit2 />}
    title="No repository yet"
  >
    Set one up to save pages and sync the design system.
  </PanelEmpty>
);
