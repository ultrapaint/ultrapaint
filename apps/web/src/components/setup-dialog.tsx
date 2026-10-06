import {
  DEFAULT_DESIGNS_DIR,
  defaultSettings,
  type Settings,
} from "@ultrapaint/contracts/settings";
import {
  applySuggestions,
  describeSuggestions,
  type SetupSuggestions,
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
import { api } from "../state/connection.ts";
import { showSetup as showSync } from "../state/design-system-setup.ts";
import { useProject } from "../state/project.ts";
import { dismissInit, useSetup } from "../state/setup.ts";

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
export const openSetup = () => useSetup.getState().open("configure");

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
 * Asked at the first edit: set the repository up, or import its design system. The editor is
 * usable without either; only changing a design needs them.
 */
export const SetupDialog = () => {
  const shown = useSetup((s) => s.shown);
  const need = useSetup((s) => s.need);
  return (
    <Dialog onOpenChange={onOpenChange} open={shown}>
      <DialogContent className="sm:max-w-lg">
        {need === "configure" ? <ConfigureForm /> : <InitPrompt />}
      </DialogContent>
    </Dialog>
  );
};

const InitPrompt = () => (
  <>
    <DialogHeader>
      <DialogTitle>Set up the design system?</DialogTitle>
      <DialogDescription>
        There is no design system yet, so agents and the inspector do not know
        your tokens, text styles or conventions. Sync works out what you have —
        a Figma file, your code's theme and components — and takes you through
        making one from it.
      </DialogDescription>
    </DialogHeader>
    <DialogFooter>
      <Button onClick={dismissInit} variant="outline">
        Not now
      </Button>
      <Button onClick={openSync}>
        <RefreshCw />
        Open Sync
      </Button>
    </DialogFooter>
  </>
);

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
    api()
      .request("setup.detect", { repoPath })
      .then((suggestions) => {
        setFound(suggestions);
        setDraft(applySuggestions(defaultSettings(repoPath), suggestions));
      })
      .catch((error: Error) => {
        setProblems([error.message]);
        setDraft(defaultSettings(repoPath));
      });
  }, [saved, repoPath]);

  const onDesignsDir = (e: React.ChangeEvent<HTMLInputElement>) => {
    const designsDir = e.target.value;
    setDraft((d) => (d ? { ...d, designsDir } : d));
  };

  const setUp = async () => {
    if (!draft) {
      return;
    }
    setBusy(true);
    try {
      // The designs directory is created when it is not there yet; nothing else is written.
      await api().request("setup.createDesigns", {
        designsDir: draft.designsDir,
        repoPath: draft.repoPath,
        resolveFrom: draft.resolveFrom,
      });
      const validation = await api().request("settings.set", draft);
      setProblems(validation.problems);
      if (validation.ok) {
        await useProject.getState().load();
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
            The tool was not started inside a git repository. Say in the
            settings which repository to design in, and where its pages go.
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
            Relative to the repository, and created if it is not there yet. The
            stylesheets and component packages detection found are in the
            settings.
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
