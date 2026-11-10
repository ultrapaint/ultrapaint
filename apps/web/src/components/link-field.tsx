import { BACK_LINK, linkTargetOf } from "@ultrapaint/shared/link";
import { TriangleAlert } from "lucide-react";
import { cn } from "@/lib/cn";
import { describeLink, linkToPage } from "../lib/links.ts";
import { basePageOf, editPageUrl, isDraft } from "../lib/page-actions.ts";
import { useEditor } from "../state/editor.ts";
import { useProject } from "../state/project.ts";
import { promptDialog } from "./dialogs.tsx";
import { OptionSelect, type SelectOption } from "./option-select.tsx";

const NOWHERE = "";
/** The option that asks for a URL of the canvas or another site. */
const OTHER = "\u0000other";

/** Asks for a URL with its parameters, or another site; null when the dialog is cancelled. */
export const askLinkUrl = async (current?: string) => {
  const target = current ? linkTargetOf(current) : null;
  const typed = await promptDialog({
    confirmLabel: "Link",
    defaultValue:
      target?.kind === "url" || target?.kind === "external" ? current : "",
    description:
      "A URL of this canvas with its parameters (/invoices/42), or another site (https://…), opened beside the prototype.",
    placeholder: "/invoices/42",
    title: "Link to a URL",
  });
  const trimmed = typed?.trim() ?? "";
  return trimmed === "" ? null : trimmed;
};

/**
 * Where a node leads when pressed in the prototype: a route of the canvas (named by its page's
 * file, so a change of URL leaves the link alone), back, a URL with its parameters, or another
 * site. A draft, a page without a route (ADR 0075), is listed after the routes: picked, it is
 * given its route first. A link to a page that is not there, or to a draft, says so.
 */
export const LinkField = ({
  className,
  link,
  mixed = false,
  onChange,
  size = "default",
}: {
  className?: string;
  link: string | undefined;
  /** Several elements are set at once and lead to different places. */
  mixed?: boolean;
  onChange: (link: string | null) => void;
  size?: "sm" | "default";
}) => {
  const canvas = useEditor((s) => s.canvas);
  const pages = useProject((s) => s.pages);
  const own = pages.filter((p) => p.canvas === canvas);
  const bases = own.filter((p) => p.variant === undefined);
  const routed = bases
    .filter((p) => !isDraft(p, own))
    .sort((a, b) =>
      (basePageOf(a, own).route ?? "").localeCompare(
        basePageOf(b, own).route ?? ""
      )
    );
  const drafts = bases
    .filter((p) => p.state === undefined && isDraft(p, own))
    .sort((a, b) => a.name.localeCompare(b.name));
  const current = link ?? NOWHERE;
  const described = link ? describeLink(own, link) : null;
  const options: SelectOption[] = [
    { label: "Nowhere", value: NOWHERE },
    ...routed.map((p) => ({
      // A page in a state (ADR 0030) serves its page's route: a link names its file.
      description: p.state === undefined ? (p.route ?? "") : "state",
      group: "Routes",
      label: p.state === undefined ? p.name : `${p.name} · ${p.state}`,
      value: linkToPage(p),
    })),
    ...drafts.map((p) => ({
      description: "no route",
      group: "Drafts",
      label: p.name,
      value: linkToPage(p),
    })),
    { group: "Other", label: "Back", value: BACK_LINK },
  ];
  if (link && !options.some((o) => o.value === link)) {
    options.push({
      group: "Other",
      label: described?.label ?? link,
      value: link,
    });
  }
  options.push({
    group: "Other",
    label: "A URL or another site…",
    value: OTHER,
  });

  const choose = async (value: string) => {
    if (value === OTHER) {
      const typed = await askLinkUrl(link);
      if (typed !== null) {
        onChange(typed);
      }
      return;
    }
    // A draft is given its route first: the prototype shows only routes.
    const draft = drafts.find((p) => linkToPage(p) === value);
    if (draft && !(await editPageUrl(draft))) {
      return;
    }
    onChange(value === NOWHERE ? null : value);
  };

  const draft = described?.draft ?? null;
  return (
    <div className={cn("flex w-full min-w-0 flex-col gap-1", className)}>
      <OptionSelect
        onChange={choose}
        options={options}
        placeholder="Mixed"
        size={size}
        value={mixed ? null : current}
      />
      {described?.broken ? (
        <span className="flex items-center gap-1.5 font-body-small text-destructive">
          <TriangleAlert className="size-3.5 shrink-0" />
          Goes to a page that is not there
        </span>
      ) : null}
      {draft && !described?.broken ? (
        <span className="flex flex-wrap items-center gap-x-1.5 font-body-small text-muted-foreground">
          <TriangleAlert className="size-3.5 shrink-0 text-warning" />
          {draft.name} is a draft, not in the prototype.
          <button
            className="text-foreground underline-offset-2 outline-none hover:underline focus-visible:underline"
            onClick={() => editPageUrl(draft)}
            type="button"
          >
            Give it a route
          </button>
        </span>
      ) : null}
    </div>
  );
};
