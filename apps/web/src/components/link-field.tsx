import { BACK_LINK, linkTargetOf } from "@ultrapaint/shared/link";
import { cn } from "cn";
import { TriangleAlert } from "lucide-react";
import { describeLink, linkToPage } from "../lib/links.ts";
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
 * Where a node leads when pressed in the prototype: a page of the canvas (named by its file, so
 * a change of URL leaves the link alone, and a page without a URL is reached too), back, a URL
 * with its parameters, or another site. A link to a page that is not there says so.
 */
export const LinkField = ({
  className,
  link,
  mixed = false,
  onChange,
  size = "sm",
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
  const bases = own
    .filter((p) => p.variant === undefined)
    .sort((a, b) => a.name.localeCompare(b.name));
  const current = link ?? NOWHERE;
  const described = link ? describeLink(own, link) : null;
  const options: SelectOption[] = [
    { label: "Nowhere", value: NOWHERE },
    ...bases.map((p) => ({
      description: p.route ?? "no URL",
      group: "Pages",
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
    onChange(value === NOWHERE ? null : value);
  };

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
        <span className="flex items-center gap-1 font-body text-destructive">
          <TriangleAlert className="size-3 shrink-0" />
          Leads to a page that is not there
        </span>
      ) : null}
    </div>
  );
};
