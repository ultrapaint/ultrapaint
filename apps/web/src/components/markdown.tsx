/**
 * Agent markdown, drawn by a renderer loaded on first use: the parser, the sanitiser and the
 * highlighter are most of the editor's weight, and nothing needs them before a message is shown.
 * Until it arrives the text is shown as it is.
 */
import { cn } from "cn";
import { Suspense } from "react";
import { deferred } from "../lib/deferred.ts";
import type { MarkdownProps } from "./markdown-render.tsx";

const renderer = deferred(() =>
  import("./markdown-render.tsx").then((m) => m.MarkdownRender)
);

/** Fetches the renderer ahead of the first message, as the editor starts. */
export const preloadMarkdown = renderer.preload;

const MarkdownRender = renderer.Component;

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
