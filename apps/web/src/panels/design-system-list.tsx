/**
 * Design system's panel (ADR 0045): the navigation of its board view. The Foundations the design
 * system has data for, then the Guidelines, DESIGN.md's sections, with a search over the tokens;
 * the item open is lit, a click opens another, and what DESIGN.md's linter finds is under them.
 * The Sync and `/init` are in its title, and the Sync's view takes its place while the set-up is
 * shown. A project with no design system yet sees the neutral palette its designs draw with, and
 * a Set up.
 */
import type { DesignFinding } from "@ultrapaint/contracts/design-system";
import { cn } from "cn";
import { AlertTriangle, RefreshCw, Search, Wand2 } from "lucide-react";
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
import { BackToPage } from "../components/back-to-page.tsx";
import { IconButton } from "../components/icon-button.tsx";
import { PanelEmpty } from "../components/panel.tsx";
import { SetupEmpty } from "../components/setup-dialog.tsx";
import { startInit } from "../lib/start-thread.ts";
import { openBoard, useBoard } from "../state/board.ts";
import { useDesignSystem } from "../state/design-system.ts";
import { useDesignSystemSetup } from "../state/design-system-setup.ts";
import { useProject } from "../state/project.ts";
import { SyncView } from "./sync.tsx";

const showSetup = () => useDesignSystemSetup.getState().show(true);
const hideSetup = () => useDesignSystemSetup.getState().show(false);

const Heading = ({ children }: { children: string }) => (
  <div className="px-3 pt-3 pb-1 font-heading-xsmall text-muted-foreground">
    {children}
  </div>
);

/** DESIGN.md's linter's errors and warnings, under the guidelines; its information says nothing to act on. */
const Findings = ({ findings }: { findings: readonly DesignFinding[] }) => {
  const shown = findings.filter((f) => f.severity !== "info");
  if (shown.length === 0) {
    return null;
  }
  return (
    <ul className="mx-3 mt-2 flex flex-col gap-1 font-body">
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

/** An item of the list: lit while its boards are open, a click opening them. */
const ItemRow = ({ item, open }: { item: SystemItem; open: boolean }) => (
  <button
    aria-current={open ? "page" : undefined}
    className="mx-1 flex h-7 w-[calc(100%-0.5rem)] items-center gap-2 rounded-md px-2 text-left font-body text-foreground/90 hover:bg-muted/60 aria-[current=page]:bg-muted aria-[current=page]:text-foreground"
    onClick={() => openBoard({ item: item.id, view: "system" })}
    type="button"
  >
    <span className="truncate">{item.name}</span>
    {item.count > 0 ? (
      <span className="ml-auto font-body text-muted-foreground tabular-nums">
        {item.count}
      </span>
    ) : null}
  </button>
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
  const foundations = foundationsOf(designSystem, query);
  const guidelines = guidelinesOf(document, query);

  return (
    <div className="flex h-full flex-col">
      {openItem === null ? null : <BackToPage />}
      <div className="flex h-10 shrink-0 items-center gap-1 pr-1.5 pl-3">
        <span className="flex-1 truncate font-heading-xsmall">
          Design system
        </span>
        <IconButton
          onClick={showSetup}
          tooltip="Sync the design system and the code"
        >
          <RefreshCw />
        </IconButton>
        <IconButton onClick={startInit} tooltip="Re-run /init with an agent">
          <Wand2 />
        </IconButton>
      </div>
      <div className="px-2 pb-1.5">
        <InputGroup>
          <InputGroupAddon>
            <Search />
          </InputGroupAddon>
          <InputGroupInput
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search tokens…"
            value={query}
          />
        </InputGroup>
      </div>
      <div className="min-h-0 flex-1 overflow-auto pb-2">
        {loaded ? null : <PanelEmpty>Reading the design system…</PanelEmpty>}
        {foundations.length > 0 ? <Heading>Foundations</Heading> : null}
        {foundations.map((item) => (
          <ItemRow item={item} key={item.id} open={item.id === openItem} />
        ))}
        {guidelines.length > 0 ? <Heading>Guidelines</Heading> : null}
        {guidelines.map((item) => (
          <ItemRow item={item} key={item.id} open={item.id === openItem} />
        ))}
        {document ? <Findings findings={document.findings} /> : null}
      </div>
      {designSystem || !loaded ? null : (
        <div className="flex shrink-0 flex-col items-start gap-2 border-t px-3 py-2.5 font-body text-muted-foreground">
          No design system yet: the boards draw the neutral look every design
          starts with.
          <Button onClick={showSetup} size="sm">
            Set up
          </Button>
        </div>
      )}
    </div>
  );
};
