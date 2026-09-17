import { getPlatform } from "@ultrapaint/client-runtime/platform";
import type { Settings } from "@ultrapaint/contracts/settings";
import { defaultSettings } from "@ultrapaint/contracts/settings";
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
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { OptionSelect } from "../components/option-select.tsx";
import { api } from "../state/connection.ts";
import { useProject } from "../state/project.ts";

const themes = [
  { label: "light", value: "light" },
  { label: "dark", value: "dark" },
];

const LIST_SEPARATOR_RE = /[\n,]/;

const list = (v: string) =>
  v
    .split(LIST_SEPARATOR_RE)
    .map((s) => s.trim())
    .filter(Boolean);

export const SettingsDialog = () => {
  const open = useProject((s) => s.settingsOpen);
  const saved = useProject((s) => s.settings);
  const onOpenChange = (o: boolean) => {
    if (saved) {
      useProject.getState().openSettings(o);
    }
  };
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="sm:max-w-xl" showCloseButton={!!saved}>
        <SettingsForm saved={saved} />
      </DialogContent>
    </Dialog>
  );
};

/** Mounted with the dialog, so every open starts from the saved settings. */
const SettingsForm = ({ saved }: { saved: Settings | null }) => {
  const [draft, setDraft] = useState<Settings>(saved ?? defaultSettings(""));
  const [problems, setProblems] = useState<readonly string[]>([]);
  const [busy, setBusy] = useState(false);
  const platform = getPlatform();

  const save = async () => {
    setBusy(true);
    try {
      const v = await api().request("settings.set", draft);
      setProblems(v.problems);
      if (v.ok) {
        useProject.getState().openSettings(false);
        await useProject.getState().load();
      }
    } catch (error) {
      setProblems([(error as Error).message]);
    }
    setBusy(false);
  };

  const applyEpicpartyDefaults = () =>
    setDraft((d) => ({
      ...d,
      componentPackages: ["@epicparty/ui-components"],
      designsDir: "products/prime/designs",
      hostCss: ["../host.css"],
      libraryDirs: ["ui/components/src/components"],
      theme: "light",
    }));

  const cancel = () => useProject.getState().openSettings(false);
  const browse = async () => {
    const p = await platform.pickFolder?.();
    if (p) {
      setDraft((d) => ({ ...d, repoPath: p }));
    }
  };
  const onRepoPath = (e: React.ChangeEvent<HTMLInputElement>) => {
    const repoPath = e.target.value;
    setDraft((d) => ({ ...d, repoPath }));
  };
  const onDesignsDir = (e: React.ChangeEvent<HTMLInputElement>) => {
    const designsDir = e.target.value;
    setDraft((d) => ({ ...d, designsDir }));
  };
  const onHostCss = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const hostCss = list(e.target.value);
    setDraft((d) => ({ ...d, hostCss }));
  };
  const onLibraryDirs = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const libraryDirs = list(e.target.value);
    setDraft((d) => ({ ...d, libraryDirs }));
  };
  const onComponentPackages = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const componentPackages = list(e.target.value);
    setDraft((d) => ({ ...d, componentPackages }));
  };
  const onFormatCommand = (e: React.ChangeEvent<HTMLInputElement>) => {
    const formatCommand = e.target.value || undefined;
    setDraft((d) => ({ ...d, formatCommand }));
  };
  const onStorybookUrl = (e: React.ChangeEvent<HTMLInputElement>) => {
    const storybookUrl = e.target.value || undefined;
    setDraft((d) => ({ ...d, storybookUrl }));
  };
  const onTheme = (v: string) =>
    setDraft((d) => ({ ...d, theme: v as Settings["theme"] }));

  return (
    <>
      <DialogHeader>
        <DialogTitle>Target repository</DialogTitle>
        <DialogDescription>
          The tool runs against a local repository. Design files live inside it
          and are versioned with the code.
        </DialogDescription>
      </DialogHeader>
      <FieldGroup className="gap-4">
        <Field>
          <FieldLabel htmlFor="settings-repo">Repository path</FieldLabel>
          <div className="flex gap-1">
            <Input
              id="settings-repo"
              onChange={onRepoPath}
              placeholder="/Users/you/code/repo"
              value={draft.repoPath}
            />
            {platform.pickFolder ? (
              <Button onClick={browse} variant="outline">
                Browse…
              </Button>
            ) : null}
          </div>
          <FieldDescription>
            Absolute path to a git repository with a package.json.
          </FieldDescription>
        </Field>
        <Field>
          <FieldLabel htmlFor="settings-designs">Designs directory</FieldLabel>
          <Input
            id="settings-designs"
            onChange={onDesignsDir}
            placeholder="products/prime/designs"
            value={draft.designsDir}
          />
          <FieldDescription>
            Relative to the repository. Should be a workspace package that
            depends on react, vite and the design system.
          </FieldDescription>
        </Field>
        <Field>
          <FieldLabel htmlFor="settings-css">Host CSS imports</FieldLabel>
          <Textarea
            className="min-h-14"
            id="settings-css"
            onChange={onHostCss}
            value={draft.hostCss.join("\n")}
          />
          <FieldDescription>
            One per line, resolved from the designs directory. Include the
            design-system Tailwind entry and fonts.
          </FieldDescription>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field>
            <FieldLabel htmlFor="settings-libs">
              Design-system source dirs
            </FieldLabel>
            <Textarea
              className="min-h-14"
              id="settings-libs"
              onChange={onLibraryDirs}
              value={draft.libraryDirs.join("\n")}
            />
            <FieldDescription>
              Stamped and catalogued. Relative to the repository, one per line.
            </FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor="settings-packages">
              Component packages
            </FieldLabel>
            <Textarea
              className="min-h-14"
              id="settings-packages"
              onChange={onComponentPackages}
              value={draft.componentPackages.join("\n")}
            />
            <FieldDescription>
              Package names whose exports form the palette.
            </FieldDescription>
          </Field>
        </div>
        <div className="grid grid-cols-[1fr_1fr_100px] gap-3">
          <Field>
            <FieldLabel htmlFor="settings-format">Formatter command</FieldLabel>
            <Input
              id="settings-format"
              onChange={onFormatCommand}
              value={draft.formatCommand ?? ""}
            />
            <FieldDescription>
              Run from the repo root after each edit. {"{file}"} is replaced.
              Leave empty to auto-detect Biome or Prettier.
            </FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor="settings-storybook">Storybook URL</FieldLabel>
            <Input
              id="settings-storybook"
              onChange={onStorybookUrl}
              placeholder="http://localhost:6006"
              value={draft.storybookUrl ?? ""}
            />
            <FieldDescription>
              Optional. Palette previews use running stories.
            </FieldDescription>
          </Field>
          <Field>
            <FieldLabel>Theme</FieldLabel>
            <OptionSelect
              onChange={onTheme}
              options={themes}
              value={draft.theme}
            />
          </Field>
        </div>
      </FieldGroup>
      {problems.length > 0 && (
        <Alert variant="destructive">
          <CircleAlert />
          <AlertTitle>The settings could not be saved</AlertTitle>
          <AlertDescription>
            <ul className="list-disc pl-4">
              {problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}
      <DialogFooter className="sm:justify-between">
        <Button onClick={applyEpicpartyDefaults} variant="ghost">
          Fill epicparty defaults
        </Button>
        <div className="flex gap-1">
          {saved ? (
            <Button onClick={cancel} variant="outline">
              Cancel
            </Button>
          ) : null}
          <Button disabled={busy} onClick={save}>
            {busy ? "Validating…" : "Save and open"}
          </Button>
        </div>
      </DialogFooter>
    </>
  );
};
