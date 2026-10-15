/**
 * DESIGN.md in the Design system panel (ADR 0027): the open format's sections in its order, each
 * with what is written under it and an Edit that writes that section alone, what the format's
 * linter says above them, and a way to the root of the repository while it is in the designs
 * directory. The front matter is not shown here: its tokens are the panel's other tab, and the
 * code's to change.
 */
import type {
  DesignDocument,
  DesignFinding,
  DesignSection,
} from "@ultrapaint/contracts/design-system";
import { cn } from "cn";
import { AlertTriangle, FileText, Pencil, Wand2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { Markdown } from "../components/markdown.tsx";
import { startCommand, startInit } from "../lib/start-thread.ts";
import { api } from "../state/connection.ts";
import { reportError } from "../state/project.ts";

/** The format's sections, in its order (`@ultrapaint/design-md/format`). */
export const FORMAT_SECTIONS = [
  "Overview",
  "Colors",
  "Typography",
  "Layout",
  "Elevation & Depth",
  "Shapes",
  "Components",
  "Do's and Don'ts",
] as const;

/** What a section is for, said under an empty one. */
const PURPOSE: Record<(typeof FORMAT_SECTIONS)[number], string> = {
  Colors: "What each colour is for, and how dark mode differs.",
  Components: "Which component to use for what, and what each variant is for.",
  "Do's and Don'ts": "The rules, short and specific.",
  "Elevation & Depth": "How layers are told apart: surfaces, shadows, borders.",
  Layout: "The grid, the spacing scale and the breakpoints.",
  Overview:
    "What the product is and for whom, its voice, and its look as a specific reference.",
  Shapes: "The radii and where each goes.",
  Typography: "The families, and which text style is for what.",
};

/** The section of the document the format calls `name`, if it has one. */
export const sectionNamed = (
  document: DesignDocument | null,
  name: string
): DesignSection | undefined =>
  document?.sections.find((s) => s.section === name || s.heading === name);

export const placeDocument = async () => {
  try {
    const { path } = await api().request(
      "designSystem.placeDocument",
      undefined
    );
    toast.success(`${path} is at the root of the repository.`);
  } catch (error) {
    reportError(error);
  }
};

const saveSection = async (name: string, text: string) => {
  try {
    await api().request("designSystem.setSection", { name, text });
    return true;
  } catch (error) {
    reportError(error);
    return false;
  }
};

/** A section's text in a plain field, written when saved: one undo step. */
const EditSection = ({ name, text }: { name: string; text: string }) => {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(text);
  const save = async () => {
    if (await saveSection(name, draft)) {
      setOpen(false);
    }
  };
  return (
    <Popover
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setDraft(text);
        }
      }}
      open={open}
    >
      <PopoverTrigger
        aria-label={`Edit ${name}`}
        className="ml-auto flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
        title={`Edit ${name}`}
      >
        <Pencil className="size-3.5" />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 gap-2 p-2">
        <span className="font-heading-xsmall">{name}</span>
        <Textarea
          className="max-h-96 min-h-32 font-code"
          onChange={(e) => setDraft(e.target.value)}
          placeholder={PURPOSE[name as keyof typeof PURPOSE] ?? ""}
          value={draft}
        />
        <span className="font-body text-muted-foreground">
          Markdown. Name a token as {"{colors.primary}"}.
        </span>
        <div className="flex justify-end gap-1.5">
          <Button onClick={() => setOpen(false)} size="sm" variant="ghost">
            Cancel
          </Button>
          <Button onClick={save} size="sm">
            Save
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
};

const SectionBlock = ({
  name,
  section,
}: {
  name: string;
  section: DesignSection | undefined;
}) => {
  const text = section?.text.trim() ?? "";
  return (
    <section className="flex flex-col gap-1 border-b px-3 py-2">
      <div className="flex items-center gap-2">
        <span className="font-heading-xsmall">{section?.heading ?? name}</span>
        <EditSection name={name} text={text} />
      </div>
      {text ? (
        <Markdown>{text}</Markdown>
      ) : (
        <span className="font-body text-muted-foreground">
          {PURPOSE[name as keyof typeof PURPOSE] ?? "Nothing written yet."}
        </span>
      )}
    </section>
  );
};

/** The linter's errors and warnings; the information lines say nothing to act on. */
const Findings = ({ findings }: { findings: readonly DesignFinding[] }) => {
  const shown = findings.filter((f) => f.severity !== "info");
  if (shown.length === 0) {
    return null;
  }
  return (
    <ul className="flex flex-col gap-1 border-b px-3 py-2 font-body">
      {shown.map((f) => (
        <li
          className={cn(
            "flex items-start gap-1.5",
            f.severity === "error"
              ? "text-destructive"
              : "text-muted-foreground"
          )}
          key={`${f.path ?? ""}${f.message}`}
        >
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          <span>
            {f.path ? <span className="font-code">{f.path}: </span> : null}
            {f.message}
          </span>
        </li>
      ))}
    </ul>
  );
};

export const DesignMdView = ({
  document,
}: {
  document: DesignDocument | null;
}) => {
  if (!document) {
    return (
      <div className="flex flex-col items-start gap-2 p-3 font-body text-muted-foreground">
        No DESIGN.md yet: the design system in the open format every agent
        reads, at the root of the repository.
        <div className="flex flex-wrap gap-1.5">
          <Button onClick={placeDocument} size="sm" variant="outline">
            <FileText />
            Write it
          </Button>
          <Button onClick={startInit} size="sm" variant="ghost">
            <Wand2 />
            Run /init
          </Button>
        </div>
      </div>
    );
  }
  const others = document.sections.filter((s) => s.section === null);
  const empty = FORMAT_SECTIONS.filter(
    (name) => !sectionNamed(document, name)?.text.trim()
  ).length;
  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-2 border-b px-3 py-1.5 font-body text-muted-foreground">
        <span
          className="min-w-0 flex-1 truncate font-code"
          title={document.path}
        >
          {document.path}
        </span>
        {document.legacy ? (
          <Button onClick={placeDocument} size="sm" variant="outline">
            Move to the root
          </Button>
        ) : null}
        {empty > 0 && !document.legacy ? (
          <Button
            onClick={() => startCommand("/sync describe")}
            size="sm"
            variant="outline"
          >
            <Wand2 />
            Write with an agent
          </Button>
        ) : null}
      </div>
      <Findings findings={document.findings} />
      {FORMAT_SECTIONS.map((name) => (
        <SectionBlock
          key={name}
          name={name}
          section={sectionNamed(document, name)}
        />
      ))}
      {others.map((s) => (
        <SectionBlock key={s.heading} name={s.heading} section={s} />
      ))}
    </div>
  );
};

/** A section's prose above the tokens it describes, when the document has written it. */
export const SectionProse = ({
  document,
  name,
}: {
  document: DesignDocument | null;
  name: string;
}) => {
  const text = sectionNamed(document, name)?.text.trim();
  return text ? (
    <div className="border-b px-3 py-2 text-muted-foreground">
      <Markdown>{text}</Markdown>
    </div>
  ) : null;
};
