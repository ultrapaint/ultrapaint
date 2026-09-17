import { Dialog } from "@base-ui/react/dialog";
import { getPlatform } from "@ultrapaint/client-runtime";
import type { Settings } from "@ultrapaint/contracts";
import { defaultSettings } from "@ultrapaint/contracts";
import * as React from "react";
import { Button, Input, Label } from "../components/ui.tsx";
import { api } from "../state/connection.ts";
import { useProject } from "../state/project.ts";

const Field = ({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) => (
  <label className="flex flex-col gap-1">
    <Label className="text-ink-2">{label}</Label>
    {children}
    {hint && <span className="text-[10px] text-ink-3">{hint}</span>}
  </label>
);

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
    <Dialog.Root open={open} onOpenChange={(o) => saved && useProject.getState().openSettings(o)}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-40 bg-black/50" />
        <Dialog.Popup className="fixed top-1/2 left-1/2 z-50 flex w-[560px] max-w-[95vw] -translate-x-1/2 -translate-y-1/2 flex-col gap-3 rounded-lg border border-line-2 bg-panel-2 p-5 shadow-2xl">
          <Dialog.Title className="font-semibold text-ink text-sm">Target repository</Dialog.Title>
          <Dialog.Description className="text-ink-3">
            The tool runs against a local repository. Design files live inside it and are versioned
            with the code.
          </Dialog.Description>
          <Field
            label="Repository path"
            hint="Absolute path to a git repository with a package.json."
          >
            <div className="flex gap-1">
              <Input
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
          </Field>
          <Field
            label="Designs directory"
            hint="Relative to the repository. Should be a workspace package that depends on react, vite and the design system."
          >
            <Input
              value={draft.designsDir}
              onChange={(e) => setDraft({ ...draft, designsDir: e.target.value })}
              placeholder="products/prime/designs"
            />
          </Field>
          <Field
            label="Host CSS imports"
            hint="One per line, resolved from the designs directory. Include the design-system Tailwind entry and fonts."
          >
            <textarea
              className="min-h-14 rounded-md border border-line bg-panel px-2 py-1 text-xs outline-none focus:border-accent"
              value={draft.hostCss.join("\n")}
              onChange={(e) => setDraft({ ...draft, hostCss: list(e.target.value) })}
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field
              label="Design-system source dirs"
              hint="Stamped and catalogued. Relative to the repository, one per line."
            >
              <textarea
                className="min-h-14 rounded-md border border-line bg-panel px-2 py-1 text-xs outline-none focus:border-accent"
                value={draft.libraryDirs.join("\n")}
                onChange={(e) => setDraft({ ...draft, libraryDirs: list(e.target.value) })}
              />
            </Field>
            <Field label="Component packages" hint="Package names whose exports form the palette.">
              <textarea
                className="min-h-14 rounded-md border border-line bg-panel px-2 py-1 text-xs outline-none focus:border-accent"
                value={draft.componentPackages.join("\n")}
                onChange={(e) => setDraft({ ...draft, componentPackages: list(e.target.value) })}
              />
            </Field>
          </div>
          <div className="grid grid-cols-[1fr_1fr_100px] gap-3">
            <Field
              label="Formatter command"
              hint="Run from the repo root after each edit. {file} is replaced. Leave empty to auto-detect Biome or Prettier."
            >
              <Input
                value={draft.formatCommand ?? ""}
                onChange={(e) => setDraft({ ...draft, formatCommand: e.target.value || undefined })}
              />
            </Field>
            <Field label="Storybook URL" hint="Optional. Palette previews use running stories.">
              <Input
                value={draft.storybookUrl ?? ""}
                onChange={(e) => setDraft({ ...draft, storybookUrl: e.target.value || undefined })}
                placeholder="http://localhost:6006"
              />
            </Field>
            <Field label="Theme">
              <select
                className="h-7 rounded-md border border-line bg-panel px-2 text-xs"
                value={draft.theme}
                onChange={(e) => setDraft({ ...draft, theme: e.target.value as Settings["theme"] })}
              >
                <option value="light">light</option>
                <option value="dark">dark</option>
              </select>
            </Field>
          </div>
          {problems.length > 0 && (
            <ul className="list-disc rounded-md border border-danger/40 bg-danger/10 py-2 pl-6 text-danger">
              {problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          )}
          <div className="flex items-center justify-between pt-1">
            <Button size="xs" onClick={applyEpicpartyDefaults}>
              Fill epicparty defaults
            </Button>
            <div className="flex gap-1">
              {saved && (
                <Button onClick={() => useProject.getState().openSettings(false)}>Cancel</Button>
              )}
              <Button variant="solid" disabled={busy} onClick={save}>
                {busy ? "Validating…" : "Save and open"}
              </Button>
            </div>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
};
