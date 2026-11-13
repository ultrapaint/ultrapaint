/** A group of the settings and a row of it: the layout every section is written in. */

import { CircleAlert, Plus, RotateCcw, TriangleAlert, X } from "lucide-react";
import type * as React from "react";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/cn";
import { IconButton } from "../components/icon-button.tsx";

/**
 * Rows on the dialog's page, edged and split by hairlines: a line, not a second surface, which
 * would sit too close to the page's own tone to read. The group's name, when the rows do not say it themselves, is a title above it,
 * and a note that holds for every row sits under the title, at a reading measure. Both start
 * where the rows' words do; an action over the whole group sits at the title's end.
 */
export const Group = ({
  action,
  children,
  message,
  note,
  title,
}: {
  /** One action over every row of the group (Open folder), at the title's end. */
  action?: React.ReactNode;
  children: React.ReactNode;
  /** What the group says of itself under its rows: why a change to one of them wasn't saved. */
  message?: React.ReactNode;
  /** What holds for every row of the group, said once under it. */
  note?: React.ReactNode;
  title?: string;
}) => (
  <section className="flex flex-col gap-2">
    {title || note || action ? (
      <div className="flex items-start gap-3 px-4">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          {title ? <h3 className="font-heading-xsmall">{title}</h3> : null}
          {note ? (
            <p className="max-w-md text-pretty font-body-small text-muted-foreground">
              {note}
            </p>
          ) : null}
        </div>
        {action ? <div className="-my-1 shrink-0">{action}</div> : null}
      </div>
    ) : null}
    <div className="divide-y rounded-lg border">{children}</div>
    {message}
  </section>
);

/** A field or a select in an `end` row: the default control, one width, on the row's right edge. */
export const rowField = "@xl:w-52";

/**
 * How a row's control sits. `end`: a switch, a select or a button at the row's right edge, the
 * words taking the rest. `field`: a field filling the right part of the row, the words a third
 * of it. `below`: what is too long for the right part (a command, a list of actions) under the
 * words, the row's full width.
 */
type Layout = "below" | "end" | "field";

/**
 * What a row says of itself under its words and its control, the row's full width: an error
 * (why the setting failed and how to fix it) on a red tint, or a notice beside a warning icon.
 */
export const RowMessage = ({
  children,
  id,
  kind,
}: {
  children: React.ReactNode;
  id?: string;
  kind: "error" | "notice";
}) =>
  kind === "error" ? (
    <div
      className="flex gap-2 rounded-md bg-destructive/10 px-3 py-2 font-body-small text-destructive"
      id={id}
      role="alert"
    >
      <CircleAlert className="mt-0.5 size-3.5 shrink-0" />
      <div className="flex min-w-0 flex-col items-start gap-2">{children}</div>
    </div>
  ) : (
    <div className="flex gap-2 font-body-small text-muted-foreground" id={id}>
      <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-warning" />
      <div className="min-w-0">{children}</div>
    </div>
  );

/**
 * A setting changed from its default puts it back: a small arrow after the setting's name, in a
 * slot of its own so the name never moves (T3 Code's reset).
 */
export const ResetButton = ({
  label,
  onReset,
}: {
  label: string;
  onReset: () => void;
}) => (
  <IconButton
    className="text-muted-foreground"
    label={`Reset ${label} to its default`}
    onClick={onReset}
    size="icon-xs"
    tooltip="Reset to default"
  >
    <RotateCcw />
  </IconButton>
);

/**
 * One setting: what it is on the left (its name and at most a muted line), its control on the
 * right, and what it says of itself (`message`, a RowMessage) under both. Below the container's
 * width the control drops under the words instead of squeezing them. `setting` names the row for
 * the settings' search, which scrolls to it; `onReset`, given while the setting differs from its
 * default, draws the reset arrow.
 */
export const Row = ({
  children,
  description,
  htmlFor,
  layout = "end",
  message,
  onReset,
  setting,
  title,
}: {
  children?: React.ReactNode;
  description?: React.ReactNode;
  htmlFor?: string;
  layout?: Layout;
  message?: React.ReactNode;
  onReset?: () => void;
  setting?: string;
  title: React.ReactNode;
}) => (
  <div
    className="flex flex-col gap-3 px-4 py-3 first:rounded-t-[inherit] last:rounded-b-[inherit]"
    data-setting={setting}
  >
    <RowLine
      description={description}
      htmlFor={htmlFor}
      layout={layout}
      onReset={onReset}
      title={title}
    >
      {children}
    </RowLine>
    {message}
  </div>
);

const RowLine = ({
  children,
  description,
  htmlFor,
  layout,
  onReset,
  title,
}: {
  children?: React.ReactNode;
  description?: React.ReactNode;
  htmlFor?: string;
  layout: Layout;
  onReset?: () => void;
  title: React.ReactNode;
}) => (
  <div
    className={cn(
      "flex flex-col gap-3",
      layout === "end" && "@xl:flex-row @xl:items-center @xl:gap-6",
      layout === "field" && "@xl:flex-row @xl:items-start @xl:gap-6"
    )}
  >
    <div
      className={cn(
        "flex min-w-0 flex-col gap-0.5",
        // Every row's words share the field rows' column; a row with no control takes the width.
        layout === "end" && (children ? "@xl:w-[36%] @xl:shrink-0" : "flex-1"),
        // The title's line sits on the field's: both 20px lines, the field's 4px in.
        layout === "field" && "@xl:w-[36%] @xl:shrink-0 @xl:pt-1"
      )}
    >
      <div className="flex min-h-5 items-center gap-1">
        {/* Label sets its line to the text's size; the title keeps its role's 20px line. */}
        <Label htmlFor={htmlFor}>{title}</Label>
        {onReset ? (
          <ResetButton
            label={typeof title === "string" ? title : "the setting"}
            onReset={onReset}
          />
        ) : null}
      </div>
      {description ? (
        <div className="text-pretty font-body-small text-muted-foreground">
          {description}
        </div>
      ) : null}
    </div>
    {children ? (
      <div
        className={cn(
          "flex min-w-0 flex-col gap-1.5",
          layout === "end" && "@xl:ml-auto @xl:shrink-0 @xl:items-end",
          layout === "field" && "flex-1"
        )}
      >
        {children}
      </div>
    ) : null}
  </div>
);

/** A status in a row: a dot in the status's colour and the word, the one form on every page. */
export const Status = ({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone: "success" | "warning" | "muted";
}) => (
  <span className="inline-flex items-center gap-1.5 font-body-small">
    <span
      aria-hidden
      className={cn(
        "size-1.5 shrink-0 rounded-full",
        tone === "success" && "bg-success",
        tone === "warning" && "bg-warning",
        tone === "muted" && "bg-muted-foreground"
      )}
    />
    {children}
  </span>
);

export interface Choice<T extends string> {
  /** Its line, always in view, so the choice is read before it is made. */
  description: string;
  label: string;
  /** Marks the likely choice once ("Recommended"). */
  tag?: string;
  value: T;
}

const CHOICE_STEPS: Record<string, number> = {
  ArrowDown: 1,
  ArrowLeft: -1,
  ArrowRight: 1,
  ArrowUp: -1,
};

/**
 * One setting's options as rows of a group, each with its line in view: a radio, the name and
 * its line; what only the chosen option takes (`children`) indented under it. Arrows move the
 * choice, as a radio group's do.
 */
export const OptionList = <T extends string>({
  "aria-label": ariaLabel,
  children,
  onChange,
  options,
  value,
}: {
  "aria-label": string;
  /** Under the chosen option, indented to its words. */
  children?: React.ReactNode;
  onChange: (value: T) => void;
  options: readonly Choice<T>[];
  value: T;
}) => {
  const list = useRef<HTMLDivElement>(null);
  const onKeyDown = (e: React.KeyboardEvent) => {
    const step = CHOICE_STEPS[e.key];
    if (step === undefined) {
      return;
    }
    e.preventDefault();
    const at = options.findIndex((o) => o.value === value);
    const next = options[(at + step + options.length) % options.length];
    if (next) {
      onChange(next.value);
      list.current
        ?.querySelector<HTMLElement>(`[data-choice="${next.value}"]`)
        ?.focus();
    }
  };
  return (
    <div
      aria-label={ariaLabel}
      className="divide-y"
      ref={list}
      role="radiogroup"
    >
      {options.map((o) => {
        const chosen = o.value === value;
        return (
          <div className="flex flex-col gap-3 px-4 py-3" key={o.value}>
            {/* biome-ignore lint/a11y/useSemanticElements: an option with its line in view, as a radio */}
            <button
              aria-checked={chosen}
              className="group flex items-start gap-3 rounded-sm text-left outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-sidebar"
              data-choice={o.value}
              onClick={() => onChange(o.value)}
              onKeyDown={onKeyDown}
              role="radio"
              tabIndex={chosen ? 0 : -1}
              type="button"
            >
              <span
                aria-hidden
                className={cn(
                  "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border",
                  chosen
                    ? "border-primary bg-primary"
                    : "border-muted-foreground group-hover:border-foreground"
                )}
              >
                {chosen ? (
                  <span className="size-1.5 rounded-full bg-primary-foreground" />
                ) : null}
              </span>
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="flex items-center gap-2 font-body-semibold">
                  {o.label}
                  {o.tag ? (
                    <span className="rounded-full bg-accent px-1.5 font-body-small-medium text-muted-foreground">
                      {o.tag}
                    </span>
                  ) : null}
                </span>
                <span className="text-pretty font-body-small text-muted-foreground">
                  {o.description}
                </span>
              </span>
            </button>
            {chosen && children ? (
              <div className="flex flex-col gap-3 pl-7">{children}</div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
};

/** "Add a folder" less its verb: the fields' names. */
const ADD_RE = /^Add an? /;

/**
 * A list of paths, one field each with its remove ×, and Add at the end: a path is saved when
 * its field is left (ADR 0079), an empty one is dropped then.
 */
export const PathList = ({
  addLabel,
  id,
  invalid,
  onChange,
  onLeave,
  placeholder,
  value,
}: {
  /** "Add a folder", "Add a stylesheet". */
  addLabel: string;
  id: string;
  /** Its ties to the reasons a refused save gave under its row. */
  invalid?: React.AriaAttributes;
  onChange: (value: string[]) => void;
  /** A field left: what was typed is saved. */
  onLeave: () => void;
  placeholder: string;
  value: readonly string[];
}) => {
  // The fields' own text while typed in: a new, empty field stays until it is left.
  const [rows, setRows] = useState<string[]>(() => [...value]);
  const [shown, setShown] = useState(value);
  if (shown !== value && rows.filter(Boolean).join("\n") !== value.join("\n")) {
    setShown(value);
    setRows([...value]);
  }
  const list = useRef<HTMLDivElement>(null);
  const put = (next: string[]) => {
    setRows(next);
    onChange(next.map((p) => p.trim()).filter(Boolean));
  };
  const leave = () => {
    const kept = rows.map((p) => p.trim()).filter(Boolean);
    if (kept.length !== rows.length) {
      setRows(kept);
    }
    onLeave();
  };
  const add = () => {
    setRows([...rows, ""]);
    requestAnimationFrame(() => {
      const inputs = list.current?.querySelectorAll("input");
      inputs?.[inputs.length - 1]?.focus();
    });
  };
  return (
    <div className="flex flex-col gap-1.5" ref={list}>
      {rows.map((path, i) => (
        <div
          className="flex items-center gap-1"
          // biome-ignore lint/suspicious/noArrayIndexKey: a row is its place in the list while typed in
          key={i}
        >
          <Input
            aria-label={`${addLabel.replace(ADD_RE, "")} ${i + 1}`}
            className="font-code"
            id={i === 0 ? id : undefined}
            onBlur={leave}
            onChange={(e) =>
              put(rows.map((p, j) => (j === i ? e.target.value : p)))
            }
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                leave();
              }
            }}
            placeholder={placeholder}
            spellCheck={false}
            value={path}
            {...invalid}
          />
          <IconButton
            onClick={() => {
              put(rows.filter((_, j) => j !== i));
              onLeave();
            }}
            size="icon-sm"
            tooltip="Remove"
          >
            <X />
          </IconButton>
        </div>
      ))}
      <Button
        className="self-start text-muted-foreground"
        onClick={add}
        size="sm"
        variant="ghost"
      >
        <Plus />
        {addLabel}
      </Button>
    </div>
  );
};
