/**
 * Where a page stands with the code that implements it (ADR 0030), in the Code tab above the
 * page's code (ADR 0102): the files, whether the design or the code changed since, what changed
 * in the design, the tokens waiting for the code, and the way to implement it, or to bring the
 * design up to date from its code (ADR 0115). A component's board has its own, smaller, for the
 * same update (ADR 0122).
 */

import {
  componentTarget,
  type ImplementationItem,
  isBound,
} from "@ultrapaint/contracts/implementation";
import type { Page } from "@ultrapaint/contracts/pages";
import { Code, Ellipsis, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/cn";
import { CutText } from "../components/cut-text.tsx";
import {
  adoptPages,
  implementPage,
  markImplemented,
  setPageReady,
  unlinkImplementation,
  updateComponentFromCode,
  updatePagesFromCode,
} from "../lib/page-actions.ts";
import { api } from "../state/connection.ts";
import {
  exportTokens,
  statusLabel,
  tokensWaiting,
  useImplementation,
} from "../state/implementation.ts";
import { Row, Section } from "./inspector-fields.tsx";

/**
 * The tokens a design uses whose value has not reached the code (ADR 0028), and a way to bring
 * them over; what changed on both sides is left for the Sync view.
 */
const TokensWaiting = ({ tokens }: { tokens: readonly string[] }) => (
  <div className="flex items-start gap-2">
    <p className="min-w-0 flex-1 font-body-small text-muted-foreground">
      {tokens.length === 1 ? "A token" : `${tokens.length} tokens`} it uses wait
      {tokens.length === 1 ? "s" : ""} for the code:{" "}
      <span className="text-foreground">{tokens.join(", ")}</span>
    </p>
    <Button
      className="shrink-0"
      onClick={() => exportTokens(tokens)}
      size="sm"
      variant="outline"
    >
      Export
    </Button>
  </div>
);

/**
 * What a page's link to its code needs once or rarely (ADR 0102): the page's menu's own entries,
 * by the same names, so Implement is the one action in view.
 */
const MoreMenu = ({
  item,
  page,
}: {
  item: ImplementationItem | undefined;
  page: Page;
}) => {
  const status = item?.status;
  const bound = status === "implemented" || status === "changed";
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger
          render={
            <DropdownMenuTrigger
              render={
                <Button
                  aria-label="More implementation actions"
                  className="text-muted-foreground data-popup-open:bg-accent data-popup-open:text-foreground"
                  size="icon-sm"
                  variant="ghost"
                />
              }
            />
          }
        >
          <Ellipsis />
        </TooltipTrigger>
        <TooltipContent>More</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" className="w-60">
        {bound ? null : (
          <DropdownMenuItem onClick={() => adoptPages([page.id])}>
            Find its code with an agent
          </DropdownMenuItem>
        )}
        {/* Not a button: a draft not built yet is unlinked too, and finds no code (ADR 0115). */}
        {bound ? null : (
          <DropdownMenuItem onClick={() => updatePagesFromCode([page.id])}>
            Update from code
          </DropdownMenuItem>
        )}
        {status === undefined || status === "draft" ? (
          <DropdownMenuItem onClick={() => setPageReady(page, true)}>
            Mark ready to implement
          </DropdownMenuItem>
        ) : null}
        {status === "ready" ? (
          <DropdownMenuItem onClick={() => setPageReady(page, false)}>
            Mark not ready
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem
          onClick={() => markImplemented(page.id, page.name, item?.files)}
        >
          {bound ? "Mark implemented again…" : "Mark implemented…"}
        </DropdownMenuItem>
        {bound ? (
          <DropdownMenuItem
            onClick={() => unlinkImplementation(page.id, page.name)}
          >
            Unlink from its code
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

/**
 * The design brought up to date from the code that changed since it was implemented (ADR 0115),
 * by an agent the person sends; what the design changed meanwhile is reconciled with the code's
 * changes, the person asked where the agent can't tell.
 */
const UpdateFromCode = ({
  designChanged,
  onUpdate,
}: {
  designChanged: boolean;
  onUpdate: () => void;
}) => (
  <>
    {designChanged ? (
      <p className="mt-1 font-body-small text-muted-foreground">
        The design changed too: the agent reconciles both, and asks you where it
        can't tell.
      </p>
    ) : null}
    <Button className="mt-1 w-full" onClick={onUpdate} variant="outline">
      <RefreshCw />
      Update from code
    </Button>
  </>
);

/** A design's status, a warning dot before it while it is behind on one side. */
const StatusRow = ({ item }: { item: ImplementationItem | undefined }) => {
  const draft = item?.status === "draft" || item === undefined;
  const behind = item?.status === "changed" || tokensWaiting(item);
  return (
    <Row label="Status">
      <span className="flex min-w-0 items-center gap-1.5 font-body">
        {behind ? (
          <span className="size-1.5 shrink-0 rounded-full bg-warning" />
        ) : null}
        <CutText className={cn("truncate", draft && "text-muted-foreground")}>
          {item && item.status !== "draft"
            ? statusLabel(item)
            : "Not implemented"}
        </CutText>
      </span>
    </Row>
  );
};

/** The files a design is implemented by. */
const FilesRow = ({ files }: { files: readonly string[] }) => (
  <Row label="Files">
    <CutText className="truncate font-body text-muted-foreground">
      {files.join(", ")}
    </CutText>
  </Row>
);

/**
 * Where a component stands with the code that implements it, on its board in the Library (ADR
 * 0122): once it is implemented, its status and files, and Update from code when its code changed
 * since. A component not implemented yet shows nothing: its board's menu implements it.
 */
export const ComponentImplementation = ({ name }: { name: string }) => {
  const item = useImplementation((s) => s.byTarget[componentTarget(name)]);
  if (!(item && isBound(item.status))) {
    return null;
  }
  return (
    <Section title="Implementation">
      <StatusRow item={item} />
      <FilesRow files={item.files} />
      {item.codeChanged ? (
        <UpdateFromCode
          designChanged={item.designChanged}
          onUpdate={() => updateComponentFromCode(name)}
        />
      ) : null}
    </Section>
  );
};

export const Implementation = ({ page }: { page: Page }) => {
  const item = useImplementation((s) => s.byTarget[page.id]);
  const designChanged = item?.designChanged ?? false;
  // What changed is read for the page and the status it has now; an answer for another is not shown.
  const key = `${page.id}:${item?.at ?? 0}:${designChanged}`;
  const [read, setRead] = useState<{ key: string; text: string } | null>(null);
  useEffect(() => {
    if (!designChanged) {
      return;
    }
    api()
      .request("implementation.changes", { target: page.id })
      .then((c) => setRead({ key, text: c.text }))
      .catch(() => undefined);
  }, [page.id, designChanged, key]);
  const changes = designChanged && read?.key === key ? read.text : null;
  const bound = item?.status === "implemented" || item?.status === "changed";
  return (
    <Section
      action={<MoreMenu item={item} page={page} />}
      className="mb-2 px-4"
      title="Implementation"
    >
      <StatusRow item={item} />
      {bound && item ? <FilesRow files={item.files} /> : null}
      {item?.tokens ? <TokensWaiting tokens={item.tokens} /> : null}
      {changes ? (
        <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-md bg-muted p-2 font-code text-muted-foreground">
          {changes}
        </pre>
      ) : null}
      {item?.codeChanged ? (
        <UpdateFromCode
          designChanged={designChanged}
          onUpdate={() => updatePagesFromCode([page.id])}
        />
      ) : null}
      <Button
        className="mt-1 w-full"
        onClick={() => implementPage(page)}
        variant="outline"
      >
        <Code />
        {item?.status === "changed" && item.designChanged
          ? "Implement what changed"
          : "Implement"}
      </Button>
    </Section>
  );
};
