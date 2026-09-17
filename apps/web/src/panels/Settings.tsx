import { getPlatform } from "@ultrapaint/client-runtime";
import type { Settings } from "@ultrapaint/contracts";
import { defaultSettings } from "@ultrapaint/contracts";
import { CircleAlert } from "lucide-react";
import * as React from "react";
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
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { OptionSelect } from "../components/option-select.tsx";
import { api } from "../state/connection.ts";
import { useProject } from "../state/project.ts";

const themes = [
  { value: "light", label: "light" },
  { value: "dark", label: "dark" },
];

const list = (v: string) =>
  v
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean);

export const SettingsDialog = () => {
  const open = useProject((s) => s.settingsOpen);
  const saved = useProject((s) => s.settings);
  const [draft, setDraft] = React.useState<Settings>(saved ?? defaultSettings(""));
  const [problems, setProblems] = React.useState<readonly string[]>([]);
  const [busy, setBusy] = React.useState(false);
  const platform = getPlatform();

  React.useEffect(() => {
    if (open) setDraft(saved ?? defaultSettings(""));
  }, [open, saved]);

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
    } finally {
      setBusy(false);
    }
  };

  const applyEpicpartyDefaults = () =>
    setDraft((d) => ({
      ...d,
      designsDir: "products/prime/designs",
      hostCss: ["../host.css"],
      libraryDirs: ["ui/components/src/components"],
      componentPackages: ["@epicparty/ui-components"],
      theme: "light",
    }));

  return (
    <Dialog open={open} onOpenChange={(o) => saved && useProject.getState().openSettings(o)}>
      <DialogContent showCloseButton={!!saved} className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Target repository</DialogTitle>
          <DialogDescription>
            The tool runs against a local repository. Design files live inside it and are versioned
            with the code.
          </DialogDescription>
        </DialogHeader>
        <FieldGroup className="gap-4">
          <Field>
            <FieldLabel htmlFor="settings-repo">Repository path</FieldLabel>
            <div className="flex gap-1">
              <Input
                id="settings-repo"
                value={draft.repoPath}
                onChange={(e) => setDraft({ ...draft, repoPath: e.target.value })}
                placeholder="/Users/you/code/repo"
              />
              {platform.pickFolder && (
                <Button
                  variant="outline"
                  onClick={async () => {
                    const p = await platform.pickFolder?.();
                    if (p) setDraft({ ...draft, repoPath: p });
                  }}
                >
                  Browse…
                </Button>
              )}
            </div>
            <FieldDescription>
              Absolute path to a git repository with a package.json.
            </FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor="settings-designs">Designs directory</FieldLabel>
            <Input
              id="settings-designs"
              value={draft.designsDir}
              onChange={(e) => setDraft({ ...draft, designsDir: e.target.value })}
              placeholder="products/prime/designs"
            />
            <FieldDescription>
              Relative to the repository. Should be a workspace package that depends on react, vite
              and the design system.
            </FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor="settings-css">Host CSS imports</FieldLabel>
            <Textarea
              id="settings-css"
              className="min-h-14"
              value={draft.hostCss.join("\n")}
              onChange={(e) => setDraft({ ...draft, hostCss: list(e.target.value) })}
            />
            <FieldDescription>
              One per line, resolved from the designs directory. Include the design-system Tailwind
              entry and fonts.
            </FieldDescription>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field>
              <FieldLabel htmlFor="settings-libs">Design-system source dirs</FieldLabel>
              <Textarea
                id="settings-libs"
                className="min-h-14"
                value={draft.libraryDirs.join("\n")}
                onChange={(e) => setDraft({ ...draft, libraryDirs: list(e.target.value) })}
              />
              <FieldDescription>
                Stamped and catalogued. Relative to the repository, one per line.
              </FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="settings-packages">Component packages</FieldLabel>
              <Textarea
                id="settings-packages"
                className="min-h-14"
                value={draft.componentPackages.join("\n")}
                onChange={(e) => setDraft({ ...draft, componentPackages: list(e.target.value) })}
              />
              <FieldDescription>Package names whose exports form the palette.</FieldDescription>
            </Field>
          </div>
          <div className="grid grid-cols-[1fr_1fr_100px] gap-3">
            <Field>
              <FieldLabel htmlFor="settings-format">Formatter command</FieldLabel>
              <Input
                id="settings-format"
                value={draft.formatCommand ?? ""}
                onChange={(e) => setDraft({ ...draft, formatCommand: e.target.value || undefined })}
              />
              <FieldDescription>
                Run from the repo root after each edit. {"{file}"} is replaced. Leave empty to
                auto-detect Biome or Prettier.
              </FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="settings-storybook">Storybook URL</FieldLabel>
              <Input
                id="settings-storybook"
                value={draft.storybookUrl ?? ""}
                onChange={(e) => setDraft({ ...draft, storybookUrl: e.target.value || undefined })}
                placeholder="http://localhost:6006"
              />
              <FieldDescription>Optional. Palette previews use running stories.</FieldDescription>
            </Field>
            <Field>
              <FieldLabel>Theme</FieldLabel>
              <OptionSelect
                value={draft.theme}
                options={themes}
                onChange={(v) => setDraft({ ...draft, theme: v as Settings["theme"] })}
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
          <Button variant="ghost" onClick={applyEpicpartyDefaults}>
            Fill epicparty defaults
          </Button>
          <div className="flex gap-1">
            {saved && (
              <Button variant="outline" onClick={() => useProject.getState().openSettings(false)}>
                Cancel
              </Button>
            )}
            <Button disabled={busy} onClick={save}>
              {busy ? "Validating…" : "Save and open"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
