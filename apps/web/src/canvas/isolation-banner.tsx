import {
  APP_FROM,
  componentOfDoc,
} from "@ultrapaint/contracts/component-names";
import { ChevronRight, Component } from "lucide-react";
import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { CutText } from "../components/cut-text.tsx";
import { CommandKeys } from "../components/shortcut-sheet.tsx";
import { instanceCountOf } from "../lib/component-uses.ts";
import { appComponentOf, useComponents } from "../state/components.ts";
import { useDocuments } from "../state/documents.ts";
import { frameRefOf, ownFrameOf } from "../state/frame-ref.ts";
import {
  editVariant,
  leaveIsolation,
  leaveTo,
  levelsOf,
  useIsolation,
} from "../state/isolation.ts";
import { useProject } from "../state/project.ts";
import { Banner } from "./banner.tsx";

/**
 * Says an app component is edited in place (ADR 0041), as a breadcrumb from the page through each
 * component it was entered through (ADR 0114), any of them a way back; which member of its choices
 * the edits land on; and the way out one level: Done, Escape (the `escape` command, its key on
 * Done), or a click anywhere outside it. It sits just over the tools, on their centre line, where the hand already is while
 * editing, the top left to the place, edged in the component colour the canvas outlines an
 * instance in. On its board (ADR 0045) the board edited says the member, its title a variant's,
 * and the banner only names the component.
 */
/**
 * How many instances an edit of the main component `name` reaches: those the pages read place, and
 * those of the app components' trees, as its inspector's "Used in" counts them.
 */
const useInstanceCount = (name: string | undefined): number => {
  const docs = useDocuments((s) => s.docs);
  const components = useComponents((s) => s.components);
  return useMemo(() => {
    if (name === undefined) {
      return 0;
    }
    // A component's tree is counted from its file, not again as a page.
    const pages = Object.values(docs)
      .filter((d) => componentOfDoc(d.doc) === null)
      .map((d) => ({ name: d.doc, root: d.root }));
    return instanceCountOf(name, APP_FROM, { components, pages });
  }, [components, docs, name]);
};

const instancesLabel = (count: number) => {
  if (count === 0) {
    return "no instances yet";
  }
  return count === 1 ? "1 instance" : `${count} instances`;
};

/** A level of the breadcrumb that goes back to it: the page or board at 0. */
const LevelButton = ({ level, name }: { level: number; name: string }) => (
  <button
    className="min-w-0 max-w-32 shrink truncate rounded px-1 outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/25"
    onClick={() => leaveTo(level)}
    type="button"
  >
    {name}
  </button>
);

/** What the breadcrumb starts from: the page the frame shows, or the board. */
const useBaseName = (frame: string | undefined) =>
  useProject((s) => {
    if (frame === undefined) {
      return "";
    }
    const ref = frameRefOf(frame);
    if (ref.kind === "board") {
      return "Board";
    }
    const own = ownFrameOf(frame);
    return s.pages.find((p) => p.id === own)?.name ?? "Page";
  });

export const IsolationBanner = () => {
  const isolated = useIsolation((s) => s.isolated);
  const base = useBaseName(isolated?.frame);
  const file = useComponents((s) =>
    isolated ? appComponentOf(s.components, isolated.component) : undefined
  );
  const instances = useInstanceCount(isolated?.component);

  if (!(isolated && file?.origin === "app")) {
    return null;
  }
  const choices = file.properties.filter((p) => p.kind === "choice");
  const onBoard = frameRefOf(isolated.frame).kind === "board";
  const levels = levelsOf(isolated);
  const current = isolated.variant
    ? `${isolated.variant.property}\n${isolated.variant.member}`
    : "";
  return (
    <Banner
      at="tools"
      className="border-component"
      icon={<Component className="text-component" />}
      label={`Editing main component ${file.name}, ${instancesLabel(instances)}`}
    >
      <nav
        aria-label="Editing main component"
        className="flex min-w-0 items-center gap-1 font-body-small text-muted-foreground"
      >
        <LevelButton level={0} name={base} />
        {levels.map((name, i) => (
          <span
            className="flex min-w-0 items-center gap-1"
            key={levels.slice(0, i + 1).join("/")}
          >
            <ChevronRight className="size-3 shrink-0" />
            {i === levels.length - 1 ? (
              <CutText
                className="min-w-0 truncate font-body-medium text-foreground"
                tip={name}
              >
                {name}
              </CutText>
            ) : (
              <LevelButton level={i + 1} name={name} />
            )}
          </span>
        ))}
        <span className="shrink-0">· {instancesLabel(instances)}</span>
      </nav>
      {choices.length > 0 && !onBoard ? (
        <Tooltip>
          <TooltipTrigger
            render={
              <NativeSelect
                aria-label="Edits land on"
                className="shrink-0 [&>select]:bg-transparent [&>select]:font-body-medium [&>select]:hover:border-transparent [&>select]:hover:bg-accent"
                onChange={(e) => {
                  const [property, member] = e.target.value.split("\n");
                  editVariant(
                    property && member !== undefined
                      ? { member, property }
                      : null
                  );
                }}
                size="sm"
                value={current}
              >
                <NativeSelectOption value="">All variants</NativeSelectOption>
                {choices.flatMap((p) =>
                  (p.members ?? []).map((m) => (
                    <NativeSelectOption
                      key={`${p.name}\n${m}`}
                      value={`${p.name}\n${m}`}
                    >
                      {p.name}: {m}
                    </NativeSelectOption>
                  ))
                )}
              </NativeSelect>
            }
          />
          <TooltipContent>Edits land on</TooltipContent>
        </Tooltip>
      ) : null}
      <Button className="shrink-0 pr-1" onClick={leaveIsolation} size="sm">
        Done
        <CommandKeys
          className="h-4 bg-primary-foreground/15 text-primary-foreground/80 ring-0"
          id="escape"
        />
      </Button>
    </Banner>
  );
};
