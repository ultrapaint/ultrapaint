/**
 * Agent markdown, drawn by a renderer loaded on first use: the parser, the sanitiser and the
 * highlighter are most of the editor's weight, and nothing needs them before a message is shown.
 * Until it arrives the text is shown as it is.
 */
import { cn } from "cn";
import { lazy, Suspense } from "react";
import type { MarkdownProps } from "./markdown-render.tsx";

const MarkdownRender = lazy(() =>
  import("./markdown-render.tsx").then((m) => ({ default: m.MarkdownRender }))
);

export const Markdown = (props: MarkdownProps) => (
  <Suspense
    fallback={
      <div className={cn("whitespace-pre-wrap font-body", props.className)}>
        {props.children}
      </div>
    }
  >
    <MarkdownRender {...props} />
  </Suspense>
);
