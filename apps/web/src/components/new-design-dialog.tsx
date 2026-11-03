/**
 * A design from nothing (PLAN-desktop D11): a name, a folder, a template, where the code goes and
 * the git integration, then the steps of writing it as the shell takes them. Only a shell that
 * writes designs has it (the desktop app); it opens from the welcome page and from the project
 * switcher.
 */
import { Check, Circle, CircleAlert, Minus, X } from "lucide-react";
import { useEffect, useState } from "react";
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
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import {
  type NewDesignInput,
  type NewDesignStepId,
  type NewDesigns,
  type NewDesignUpdate,
  platform,
} from "../platform.ts";
import { Segmented } from "./segmented.tsx";

const useNewDesign = create<{ shown: boolean }>(() => ({ shown: false }));

/** Opens the dialog, where the shell writes designs. */
export const openNewDesign = () => useNewDesign.setState({ shown: true });

/** Whether the shell writes designs from nothing. */
export const canMakeNewDesigns = () => platform().newDesign !== undefined;

const STEP_LABELS: Record<NewDesignStepId, string> = {
  folder: "Create the folder",
  git: "Make the first commit",
  install: "Install packages",
  open: "Open the design",
  write: "Write the designs and the code",
};

const TEMPLATE_DESCRIPTIONS = {
  blank:
    "No components and an empty theme: the design system starts from nothing.",
  starter:
    "Ten components to restyle in the editor: a button, inputs, a card, a dialog, tabs…",
} as const;

const CODE_DESCRIPTIONS = {
  app: "A Vite, React and Tailwind app in app/, beside the designs.",
  root: "The app at the folder’s root, the designs beside its src/.",
} as const;

const messageOf = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

const StepIcon = ({ state }: { state: NewDesignUpdate["state"] | null }) => {
  if (state === "active") {
    return <Spinner />;
  }
  if (state === "done") {
    return <Check className="text-success" />;
  }
  if (state === "failed") {
    return <X className="text-destructive" />;
  }
  if (state === "skipped") {
    return <Minus className="text-muted-foreground" />;
  }
  // Not reached yet.
  return <Circle className="scale-50 text-muted-foreground" />;
};

/** The steps as far as they went, in order. */
const Steps = ({
  git,
  progress,
}: {
  git: boolean;
  progress: Partial<Record<NewDesignStepId, NewDesignUpdate>>;
}) => {
  const steps: NewDesignStepId[] = [
    "folder",
    "write",
    "install",
    ...(git ? (["git"] as const) : []),
    "open",
  ];
  return (
    <ol className="flex flex-col gap-2 rounded-lg bg-muted p-3">
      {steps.map((step) => {
        const at = progress[step];
        return (
          <li
            className="flex items-start gap-2 [&_svg]:mt-0.5 [&_svg]:size-4 [&_svg]:shrink-0"
            key={step}
          >
            <StepIcon state={at?.state ?? null} />
            <span className="flex min-w-0 flex-col">
              <span className={at ? "font-label" : "text-muted-foreground"}>
                {STEP_LABELS[step]}
              </span>
              {at?.detail && at.state !== "failed" ? (
                <span
                  className="truncate font-small text-muted-foreground"
                  title={at.detail}
                >
                  {at.detail}
                </span>
              ) : null}
            </span>
          </li>
        );
      })}
    </ol>
  );
};

const Form = ({ designs }: { designs: NewDesigns }) => {
  const [name, setName] = useState("");
  const [folder, setFolder] = useState("");
  // A folder the user picked stays, whatever the name becomes.
  const [picked, setPicked] = useState(false);
  const [template, setTemplate] = useState<NewDesignInput["template"]>("blank");
  const [code, setCode] = useState<NewDesignInput["code"]>("app");
  const [git, setGit] = useState(false);
  const [progress, setProgress] = useState<
    Partial<Record<NewDesignStepId, NewDesignUpdate>>
  >({});
  const [busy, setBusy] = useState(false);
  // Written, and not opened in place of a project the user kept open.
  const [finished, setFinished] = useState(false);
  const [failed, setFailed] = useState<{
    message: string;
    step: NewDesignStepId;
  } | null>(null);
  const title = name.trim() || "Untitled";

  useEffect(() => {
    if (picked) {
      return;
    }
    let current = true;
    designs
      .folderFor(title)
      .then((proposed) => {
        if (current) {
          setFolder(proposed);
        }
      })
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [designs, picked, title]);

  const { pickFolder } = platform();
  const choose = () =>
    pickFolder?.({ defaultPath: folder, title: "Where the design goes" })
      .then((chosen) => {
        if (chosen) {
          setFolder(chosen);
          setPicked(true);
        }
      })
      .catch((error: unknown) =>
        setFailed({ message: messageOf(error), step: "folder" })
      );

  const run = async () => {
    setBusy(true);
    setFailed(null);
    setProgress({});
    try {
      const result = await designs.create(
        { code, folder, git, name: title, template },
        (next) => setProgress((all) => ({ ...all, [next.step]: next }))
      );
      setFailed(result.failed ?? null);
      setFinished(result.failed === undefined);
    } catch (error) {
      setFailed({ message: messageOf(error), step: "open" });
    }
    // Written and opened, the window shows the design's editor in place of this one.
    setBusy(false);
  };

  const openAsItIs = () => {
    setBusy(true);
    designs
      .open(folder, title, template)
      .catch((error: unknown) =>
        setFailed({ message: messageOf(error), step: "open" })
      )
      .finally(() => setBusy(false));
  };

  // Written before a later step failed, it is there to open, or to finish with another try;
  // failed before, nothing is written and the form is there to change.
  const written =
    failed !== null &&
    (progress.write?.state === "done" || progress.write?.state === "skipped");

  return (
    <>
      <DialogHeader>
        <DialogTitle>New design</DialogTitle>
        <DialogDescription>
          A folder with your designs and an app to draw with. Only Node.js is
          needed.
        </DialogDescription>
      </DialogHeader>
      {busy || written || finished ? (
        <Steps git={git} progress={progress} />
      ) : (
        <FieldGroup className="gap-4">
          <Field>
            <FieldLabel htmlFor="new-design-name">Name</FieldLabel>
            <Input
              autoFocus
              id="new-design-name"
              onChange={(e) => setName(e.target.value)}
              placeholder="Untitled"
              value={name}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="new-design-folder">Folder</FieldLabel>
            <div className="flex gap-1">
              <Input
                className="font-code"
                id="new-design-folder"
                onChange={(e) => {
                  setFolder(e.target.value);
                  setPicked(true);
                }}
                value={folder}
              />
              {pickFolder ? (
                <Button onClick={choose} variant="outline">
                  Choose…
                </Button>
              ) : null}
            </div>
            <FieldDescription className="font-small">
              Made if it is missing; otherwise it must be empty.
            </FieldDescription>
          </Field>
          <Field>
            <FieldLabel>Template</FieldLabel>
            <Segmented
              onChange={setTemplate}
              options={[
                { label: "Blank", value: "blank" },
                { label: "Starter components", value: "starter" },
              ]}
              value={template}
            />
            <FieldDescription className="font-small">
              {TEMPLATE_DESCRIPTIONS[template]}
            </FieldDescription>
          </Field>
          <Field>
            <FieldLabel>Code</FieldLabel>
            <Segmented
              onChange={setCode}
              options={[
                { label: "In app/", value: "app" },
                { label: "At the root", value: "root" },
              ]}
              value={code}
            />
            <FieldDescription className="font-small">
              {CODE_DESCRIPTIONS[code]}
            </FieldDescription>
          </Field>
          <Field orientation="horizontal">
            <FieldContent>
              <FieldLabel htmlFor="new-design-git">Keep in git</FieldLabel>
              <FieldDescription className="font-small">
                A first commit now; the Changes panel commits after.
              </FieldDescription>
            </FieldContent>
            <Switch
              checked={git}
              id="new-design-git"
              onCheckedChange={setGit}
            />
          </Field>
        </FieldGroup>
      )}
      {failed ? (
        <Alert variant="destructive">
          <CircleAlert />
          <AlertTitle>
            Couldn’t {STEP_LABELS[failed.step].toLowerCase()}
          </AlertTitle>
          <AlertDescription className="max-h-40 overflow-y-auto whitespace-pre-wrap font-code">
            {failed.message}
          </AlertDescription>
        </Alert>
      ) : null}
      <DialogFooter>
        <Button
          disabled={busy}
          onClick={() => useNewDesign.setState({ shown: false })}
          variant="outline"
        >
          {failed || finished ? "Close" : "Cancel"}
        </Button>
        {written ? (
          <Button disabled={busy} onClick={openAsItIs} variant="outline">
            Open as it is
          </Button>
        ) : null}
        {finished ? null : (
          <Button disabled={busy || folder.trim() === ""} onClick={run}>
            {busy ? <Spinner /> : null}
            {written ? "Try again" : "Create"}
          </Button>
        )}
      </DialogFooter>
    </>
  );
};

/** The dialog, where the shell writes designs; nothing in a browser. */
export const NewDesignDialog = () => {
  const shown = useNewDesign((s) => s.shown);
  const designs = platform().newDesign;
  if (!designs) {
    return null;
  }
  return (
    <Dialog
      onOpenChange={(open) => {
        if (!open) {
          useNewDesign.setState({ shown: false });
        }
      }}
      open={shown}
    >
      <DialogContent className="gap-5 sm:max-w-md">
        {/* Mounted with the dialog: each opening starts from a fresh form. */}
        {shown ? <Form designs={designs} /> : null}
      </DialogContent>
    </Dialog>
  );
};
