/**
 * Where a page stands with the code that implements it (ADR 0030), in the Code tab above the
 * page's code (ADR 0102): the files, whether the design or the code changed since, what changed
 * in the design, the tokens waiting for the code, and the way to implement it.
 */

import type { ImplementationItem } from "@ultrapaint/contracts/implementation";
import type { Page } from "@ultrapaint/contracts/pages";
import { Code, Ellipsis } from "lucide-react";
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
      <span className="font-code text-foreground">{tokens.join(", ")}</span>
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
  const draft = item?.status === "draft" || item === undefined;
  const behind = item?.status === "changed" || tokensWaiting(item);
  return (
    <Section
      action={<MoreMenu item={item} page={page} />}
      className="mb-2 px-4"
      title="Implementation"
    >
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
      {bound && item ? (
        <Row label="Files">
          <CutText className="truncate font-code text-muted-foreground">
            {item.files.join(", ")}
          </CutText>
        </Row>
      ) : null}
      {item?.tokens ? <TokensWaiting tokens={item.tokens} /> : null}
      {changes ? (
        <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-md bg-muted p-2 font-code text-muted-foreground">
          {changes}
        </pre>
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
