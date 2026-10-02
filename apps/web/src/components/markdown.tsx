import { cn } from "cn";
import { Streamdown } from "streamdown";

/**
 * Streamdown ships typography for a full-width page; the agent panel runs at
 * `font-body` in a column a few hundred pixels wide, so every block is
 * pulled back in. Each element carries a `data-streamdown` slot, which is what
 * these selectors hang off instead of replacing the renderers.
 */
const compact = [
  "space-y-2 font-body",
  "[&_[data-streamdown^=heading]]:mt-3 [&_[data-streamdown^=heading]]:mb-1",
  // Sized one by one: a shared `^=heading` size would land later in the sheet
  // than these and win the tie on equal specificity.
  "[&_[data-streamdown=heading-1]]:font-heading-small",
  "[&_[data-streamdown=heading-2]]:font-heading-xsmall",
  "[&_:is([data-streamdown=heading-3],[data-streamdown=heading-4],[data-streamdown=heading-5],[data-streamdown=heading-6])]:font-heading-xsmall",
  "[&_[data-streamdown$=list]]:my-1 [&_[data-streamdown$=list]]:list-outside [&_[data-streamdown$=list]]:pl-4",
  "[&_[data-streamdown=list-item]]:py-0",
  "[&_[data-streamdown=blockquote]]:my-2 [&_[data-streamdown=blockquote]]:border-l-2 [&_[data-streamdown=blockquote]]:pl-2",
  "[&_[data-streamdown=horizontal-rule]]:my-3",
  "[&_[data-streamdown=inline-code]]:font-code",
  "[&_[data-streamdown=code-block]]:my-2 [&_[data-streamdown=code-block]]:rounded-md [&_[data-streamdown=code-block]]:p-1",
  // The header keeps its height: the copy button is pulled up over it by a
  // fixed margin, and shrinking one without the other tears them apart.
  "[&_[data-streamdown=code-block-header]]:font-body",
  "[&_[data-streamdown=code-block-body]]:border-0 [&_[data-streamdown=code-block-body]]:p-2 [&_[data-streamdown=code-block-body]]:font-code",
  "[&_[data-streamdown=table-cell]]:px-2 [&_[data-streamdown=table-cell]]:py-1 [&_[data-streamdown=table-cell]]:font-body",
  "[&_[data-streamdown=table-header-cell]]:px-2 [&_[data-streamdown=table-header-cell]]:py-1 [&_[data-streamdown=table-header-cell]]:font-body [&_[data-streamdown=table-header-cell]]:font-semibold",
  "[&_[data-streamdown=link]]:text-brand",
].join(" ");

/** Downloads are meaningless in a local panel; copy and fullscreen are not. */
const controls = {
  code: { download: false },
  image: false,
  mermaid: false,
  table: { download: false },
} as const;

/**
 * Agent markdown. `streaming` says the text is still being appended, which is
 * what lets Streamdown close the dangling `**` or fence of a half-sent block.
 */
export const Markdown = ({
  children,
  className,
  codeBlockMaxHeight = 240,
  streaming = false,
}: {
  children: string;
  className?: string;
  /** How tall a code block grows before it scrolls, as CSS; `"none"` lets it grow. */
  codeBlockMaxHeight?: number | string;
  streaming?: boolean;
}) => (
  <Streamdown
    className={cn(compact, className)}
    codeBlockMaxHeight={codeBlockMaxHeight}
    controls={controls}
    lineNumbers={false}
    mode={streaming ? "streaming" : "static"}
  >
    {children}
  </Streamdown>
);
