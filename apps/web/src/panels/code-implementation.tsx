/**
 * Where a page stands with the code that implements it (ADR 0030), in the Code tab above the
 * page's code (ADR 0102): the files, whether the design or the code changed since, what changed
 * in the design, the tokens waiting for the code, and the way to implement it.
 */

import type { Page } from "@ultrapaint/contracts/pages";
import { Code } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { CutText } from "../components/cut-text.tsx";
import {
  implementPage,
  markImplemented,
  setPageReady,
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
    <Section className="mb-2 px-4" title="Implementation">
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
      <div className="flex flex-col gap-1 pt-1">
        <Button
          className="w-full"
          onClick={() => implementPage(page)}
          variant="outline"
        >
          <Code />
          {item?.status === "changed" && item.designChanged
            ? "Implement what changed"
            : "Implement"}
        </Button>
        <div className="flex gap-1">
          {draft ? (
            <Button
              className="flex-1"
              onClick={() => setPageReady(page, true)}
              size="sm"
              variant="ghost"
            >
              Mark ready
            </Button>
          ) : null}
          <Button
            className="flex-1"
            onClick={() => markImplemented(page.id, page.name, item?.files)}
            size="sm"
            variant="ghost"
          >
            {bound ? "Mark implemented again…" : "Mark implemented…"}
          </Button>
        </div>
      </div>
    </Section>
  );
};
