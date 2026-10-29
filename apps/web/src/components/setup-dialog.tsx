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
import { CircleAlert, FolderSearch, RefreshCw, Rocket } from "lucide-react";
import type * as React from "react";
import { useEffect, useState } from "react";
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
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
} from "@/components/ui/empty";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { startApplication } from "../lib/scaffold.ts";
import { detect, setUpDesigns } from "../lib/settings-actions.ts";
import { showSetup as showSync } from "../state/design-system-setup.ts";
import { useProject } from "../state/project.ts";
import { useSetup } from "../state/setup.ts";

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
      <DialogContent className="sm:max-w-lg">
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
            The tool does not know which folder to design in. Say in the
            settings where it is, and where its pages go.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button onClick={close} variant="outline">
            Cancel
          </Button>
          <Button onClick={configureFolders}>Configure folders…</Button>
        </DialogFooter>
      </>
    );
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Set up this repository</DialogTitle>
        <DialogDescription>
          Pages are design documents in the repository, versioned with the code.
          Say where they go, then Sync takes you through the design system: from
          a Figma file, from your code, or from scratch.
        </DialogDescription>
      </DialogHeader>
      {found ? (
        <Alert>
          <FolderSearch />
          <AlertDescription>{describeSuggestions(found)}</AlertDescription>
        </Alert>
      ) : null}
      {found && found.anchors.length === 0 ? (
        <Button
          className="self-start"
          disabled={busy}
          onClick={() => startNew(found, repoPath)}
          variant="outline"
        >
          <Rocket />
          Start a new application here…
        </Button>
      ) : null}
      <FieldGroup className="gap-4">
        <Field>
          <FieldLabel>Repository</FieldLabel>
          <Input readOnly tabIndex={-1} value={repoPath} />
        </Field>
        <Field>
          <FieldLabel htmlFor="setup-designs">Designs directory</FieldLabel>
          <Input
            disabled={!draft}
            id="setup-designs"
            onChange={onDesignsDir}
            placeholder={DEFAULT_DESIGNS_DIR}
            value={draft?.designsDir ?? ""}
          />
          <FieldDescription>
            Relative to the repository, and created if it is not there yet.
          </FieldDescription>
        </Field>
        <Field>
          <FieldLabel htmlFor="setup-stylesheet">Stylesheet</FieldLabel>
          <Input
            disabled={!draft}
            id="setup-stylesheet"
            onChange={(e) => setStylesheet(e.target.value)}
            placeholder="src/index.css"
            value={shownStylesheet}
          />
          <FieldDescription>
            Your application's stylesheet with its theme, relative to the
            repository: Sync reads your tokens from it and writes the design's
            back. Empty when there is none yet.
          </FieldDescription>
        </Field>
      </FieldGroup>
      {problems.length > 0 && (
        <Alert variant="destructive">
          <CircleAlert />
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
        <Button onClick={close} variant="ghost">
          Cancel
        </Button>
        <Button onClick={configureFolders} variant="outline">
          Configure folders…
        </Button>
        <Button disabled={busy || !draft} onClick={setUp}>
          <RefreshCw />
          {busy ? "Setting up…" : "Set up and sync"}
        </Button>
      </DialogFooter>
    </>
  );
};

/** What a panel shows while no repository is set up. */
export const SetupEmpty = () => (
  <Empty className="h-full">
    <EmptyHeader>
      <EmptyDescription>No repository is set up yet.</EmptyDescription>
    </EmptyHeader>
    <EmptyContent>
      <Button onClick={openSetup} size="sm" variant="outline">
        Set up…
      </Button>
    </EmptyContent>
  </Empty>
);
