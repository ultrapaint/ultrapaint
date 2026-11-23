/**
 * The main component edited in place (ADR 0114), said where its fields are edited: the top of the
 * Design tab (ADR 0120). A breadcrumb from the page or board through each component it was
 * entered through, any of them a way back; how many instances an edit reaches; which member of its
 * choices the edits land on; and the way out one level, Done or Escape (the `escape` command). It
 * is drawn whatever is selected in the component, and with nothing selected.
 */
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
import { Row } from "./inspector-fields.tsx";

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
    className="-mx-1 min-w-0 max-w-28 shrink truncate rounded px-1 text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/25"
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

/** The main component edited in place, at the top of the Design tab; nothing while none is. */
export const MainComponentSection = () => {
  const isolated = useIsolation((s) => s.isolated);
  const base = useBaseName(isolated?.frame);
  const file = useComponents((s) =>
    isolated ? appComponentOf(s.components, isolated.component) : undefined
  );
  const instances = useInstanceCount(isolated?.component);
  if (!(isolated && file?.origin === "app")) {
    return null;
  }
  // On its board the board edited is the member (ADR 0045): the edits land there.
  const choices =
    frameRefOf(isolated.frame).kind === "board"
      ? []
      : file.properties.filter((p) => p.kind === "choice");
  const levels = levelsOf(isolated);
  const current = isolated.variant
    ? `${isolated.variant.property}\n${isolated.variant.member}`
    : "";
  return (
    <section
      aria-label={`Editing main component ${file.name}`}
      className="flex flex-col gap-1 border-b px-3 py-2"
      data-main-component=""
    >
      <div className="flex h-7 items-center gap-2">
        <Component className="size-4 shrink-0 text-component" />
        <nav
          aria-label="Main components edited"
          className="flex min-w-0 flex-1 items-center gap-1 font-body"
        >
          <LevelButton level={0} name={base} />
          {levels.map((name, i) => (
            <span
              className="flex min-w-0 items-center gap-1"
              key={levels.slice(0, i + 1).join("/")}
            >
              <ChevronRight className="size-3 shrink-0 text-muted-foreground" />
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
        </nav>
        <Button
          className="-mr-1 shrink-0 pr-1"
          onClick={leaveIsolation}
          size="sm"
          variant="secondary"
        >
          Done
          <CommandKeys className="h-4" id="escape" />
        </Button>
      </div>
      <p className="pl-6 font-body-small text-muted-foreground">
        Main component · {instancesLabel(instances)}
      </p>
      {choices.length > 0 ? (
        <Row label="Edits land on">
          <NativeSelect
            aria-label="Edits land on"
            className="w-full"
            onChange={(e) => {
              const [property, member] = e.target.value.split("\n");
              editVariant(
                property && member !== undefined ? { member, property } : null
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
        </Row>
      ) : null}
    </section>
  );
};
