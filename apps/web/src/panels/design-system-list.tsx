/**
 * Design system's panel (ADR 0045): the navigation of its board view. The Foundations the design
 * system has data for, then the Guidelines, DESIGN.md's sections, with a search over the tokens;
 * the item open is lit, a click opens another, and what DESIGN.md's linter finds is under them.
 * The Sync and `/init` are in its title, a step the sync waits on is a row over the list, and the
 * Sync's view takes its place while the set-up is shown. A project with no design system yet sees
 * the neutral palette its designs draw with, and a Set up.
 */
import type { DesignFinding } from "@ultrapaint/contracts/design-system";
import { cn } from "cn";
import { AlertTriangle, Palette, RefreshCw, Search, Wand2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import {
  foundationsOf,
  guidelinesOf,
  type SystemItem,
} from "../boards/system-boards.ts";
import { IconButton } from "../components/icon-button.tsx";
import { PanelEmpty } from "../components/panel.tsx";
import { SetupEmpty } from "../components/setup-dialog.tsx";
import { startInit } from "../lib/start-thread.ts";
import { openBoard, useBoard } from "../state/board.ts";
import { useDesignSystem } from "../state/design-system.ts";
import { useDesignSystemSetup } from "../state/design-system-setup.ts";
import { useProject } from "../state/project.ts";
import { syncWaiting, useSync } from "../state/sync.ts";
import { SyncView } from "./sync.tsx";

const showSetup = () => useDesignSystemSetup.getState().show(true);
const hideSetup = () => useDesignSystemSetup.getState().show(false);

/** A group's name over its rows: small and muted, as the rows say what it holds. */
const Heading = ({ children }: { children: string }) => (
  <h3 className="flex h-9 items-end px-4 pb-1.5 font-small text-muted-foreground">
    {children}
  </h3>
);

/** DESIGN.md's linter's errors and warnings, under the guidelines; its information says nothing to act on. */
const Findings = ({ findings }: { findings: readonly DesignFinding[] }) => {
  const shown = findings.filter((f) => f.severity !== "info");
  if (shown.length === 0) {
    return null;
  }
  return (
    <ul className="mt-3 flex flex-col gap-2 px-3 font-small">
      {shown.map((f) => (
        <li
          className="flex items-start gap-2"
          key={`${f.path ?? ""}${f.message}`}
        >
          <AlertTriangle
            className={cn(
              "mt-0.5 size-3.5 shrink-0",
              f.severity === "error" ? "text-destructive" : "text-warning"
            )}
          />
          <span className="min-w-0 text-muted-foreground">
            {f.path ? (
              <span className="font-code text-foreground">{f.path} </span>
            ) : null}
            {f.message}
          </span>
        </li>
      ))}
    </ul>
  );
};

/** An item of the list: lit while its boards are open, a click opening them, its count at the right. */
const ItemRow = ({ item, open }: { item: SystemItem; open: boolean }) => (
  <button
    aria-current={open ? "page" : undefined}
    className="mx-2 flex h-7 w-[calc(100%-1rem)] items-center gap-2 rounded-md px-2 text-left font-label text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:bg-accent focus-visible:text-foreground aria-[current=page]:bg-accent aria-[current=page]:text-foreground"
    onClick={() => openBoard({ item: item.id, view: "system" })}
    title={item.name}
    type="button"
  >
    <span className="truncate">{item.name}</span>
    {item.count > 0 ? (
      <span className="ml-auto font-caption text-muted-foreground tabular-nums">
        {item.count}
      </span>
    ) : null}
  </button>
);

/** While the list is read: rows in its shape. */
const LoadingRows = () => (
  <div
    aria-busy="true"
    aria-label="Reading the design system"
    className="flex flex-col"
    role="status"
  >
    {[56, 80, 64, 52, 72].map((width) => (
      <div className="mx-2 flex h-7 items-center px-2" key={width}>
        <span
          className="h-2.5 animate-pulse rounded-full bg-muted"
          style={{ width }}
        />
      </div>
    ))}
  </div>
);

/** The sync has something waiting (the rail's dot): what, and the way to it. */
const SyncWaiting = () => {
  const waiting = useSync((s) =>
    syncWaiting(s.plan)
      ? (s.plan?.steps.find((step) => step.state === "attention") ?? null)
      : null
  );
  if (!waiting) {
    return null;
  }
  return (
    <button
      className="mx-2 mb-1 flex min-h-7 w-[calc(100%-1rem)] items-center gap-2 rounded-md px-2 py-1 text-left outline-none transition-colors hover:bg-accent focus-visible:bg-accent"
      onClick={showSetup}
      title={waiting.detail}
      type="button"
    >
      <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-warning" />
      <span className="min-w-0 flex-1 truncate font-small">
        {waiting.title}
      </span>
      <span className="shrink-0 font-small text-muted-foreground">Review</span>
    </button>
  );
};

/** No design system yet: what the boards show meanwhile, and the one way to make one. */
const NoDesignSystem = () => (
  <div className="mt-6 flex flex-col items-start gap-1 px-4">
    <Palette className="mb-1 size-5 text-muted-foreground" />
    <span className="font-label">No design system yet</span>
    <span className="font-small text-muted-foreground">
      Your designs use the neutral look until you set one up from your code,
      DESIGN.md or Figma.
    </span>
    <Button className="mt-2" onClick={showSetup} size="sm">
      Set up design system
    </Button>
  </div>
);

export const DesignSystemList = () => {
  const configured = useProject((s) => s.info.configured);
  const designSystem = useDesignSystem((s) => s.designSystem);
  const document = useDesignSystem((s) => s.document);
  const loaded = useDesignSystem((s) => s.loaded);
  const setupShown = useDesignSystemSetup((s) => s.shown);
  const openItem = useBoard((s) =>
    s.open?.view === "system" ? s.open.item : null
  );
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (configured && !loaded) {
      useDesignSystem.getState().load();
    }
  }, [configured, loaded]);

  if (!configured) {
    return <SetupEmpty />;
  }
  if (setupShown) {
    return <SyncView onBack={designSystem ? hideSetup : undefined} />;
  }
  // Nothing is listed until the design system is read: the neutral Color would show meanwhile.
  const foundations = loaded ? foundationsOf(designSystem, query) : [];
  const guidelines = loaded ? guidelinesOf(document, query) : [];
  const searching = query.trim() !== "";

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-11 shrink-0 items-center gap-0.5 pr-2 pl-3">
        <h2 className="flex-1 truncate font-heading-xsmall">Foundations</h2>
        <IconButton
          className="text-muted-foreground"
          onClick={showSetup}
          tooltip="Sync with the code"
        >
          <RefreshCw />
        </IconButton>
        <IconButton
          className="text-muted-foreground"
          onClick={startInit}
          tooltip="Run /init with an agent"
        >
          <Wand2 />
        </IconButton>
      </div>
      <div className="shrink-0 px-2 pb-2">
        <InputGroup>
          <InputGroupAddon>
            <Search />
          </InputGroupAddon>
          <InputGroupInput
            aria-label="Search tokens and guidelines"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape" && query) {
                e.stopPropagation();
                setQuery("");
              }
            }}
            placeholder="Search"
            value={query}
          />
        </InputGroup>
      </div>
      <div className="min-h-0 flex-1 overflow-auto pb-2">
        {loaded ? <SyncWaiting /> : <LoadingRows />}
        {foundations.map((item) => (
          <ItemRow item={item} key={item.id} open={item.id === openItem} />
        ))}
        {guidelines.length > 0 ? <Heading>Guidelines</Heading> : null}
        {guidelines.map((item) => (
          <ItemRow item={item} key={item.id} open={item.id === openItem} />
        ))}
        {loaded && searching && foundations.length + guidelines.length === 0 ? (
          <PanelEmpty
            action={
              <Button
                onClick={() => setQuery("")}
                size="sm"
                variant="secondary"
              >
                Clear search
              </Button>
            }
            icon={<Search />}
            title={`Nothing matches “${query.trim()}”`}
          >
            Search by a token’s name or value, or a guideline’s words.
          </PanelEmpty>
        ) : null}
        {document ? <Findings findings={document.findings} /> : null}
        {designSystem || !loaded || searching ? null : <NoDesignSystem />}
      </div>
    </div>
  );
};
