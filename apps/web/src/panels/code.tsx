/**
 * The selected node as code: JSX with the design system's components and the classes of the
 * project's style system, everything under it included, by the rules an agent implements a page
 * by. It is the reference translation, for reading a design as code and seeing why it draws as it
 * does; the application's code is still written by an agent, in the repository's conventions.
 * The server writes it, through the style system (ADR 0024): Tailwind's utilities today.
 */

import type { DesignNode } from "@ultrapaint/contracts/document";
import { pageComponentName } from "@ultrapaint/design-document/code";
import { layoutOf, type ParentLayout } from "@ultrapaint/design-document/css";
import { slotLayoutOf } from "@ultrapaint/design-document/slots";
import {
  findPath,
  nodeKind,
  nodeLabel,
} from "@ultrapaint/design-document/tree";
import { routeOf } from "@ultrapaint/shared/route";
import { Check, Code as CodeIcon, Copy } from "lucide-react";
import { useEffect, useState } from "react";
import { IconButton } from "../components/icon-button.tsx";
import { useComponents } from "../state/components.ts";
import { api } from "../state/connection.ts";
import { useDesignSystem } from "../state/design-system.ts";
import { rootOfFrame, useDocuments } from "../state/documents.ts";
import { useEditor } from "../state/editor.ts";
import { ownFrameOf } from "../state/frame-ref.ts";
import { reportError, useProject } from "../state/project.ts";
import { EmptyState } from "./inspector-fields.tsx";

/** A piece of JSX the view draws on its own: what reads first, or what qualifies it. */
const TOKEN_RE =
  /("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|<\/?[A-Za-z][\w.]*|\/?>|[A-Za-z_$][\w$-]*(?==)|[{}=;,]|\b(?:import|from|export|const|return)\b)/g;
const TAG_OPEN_RE = /^<\/?/;
const QUIET_RE =
  /^(?:<\/?|\/?>|[{}=;,]|import|from|export|const|return|[A-Za-z_$][\w$-]*)$/;

const SPACES_RE = /(\s+)/;

/**
 * Text that wraps only between its words: a class (`justify-between`) is never cut at its
 * hyphen. A word longer than a line (a URL) still breaks where it must.
 */
const Words = ({ text }: { text: string }) => {
  let at = 0;
  return text.split(SPACES_RE).map((word) => {
    const start = at;
    at += word.length;
    return word.length > 0 && word.length <= 24 && !SPACES_RE.test(word) ? (
      <span className="whitespace-nowrap" key={start}>
        {word}
      </span>
    ) : (
      word
    );
  });
};

/** A line's tokens: tags' names and strings in the foreground, the rest of the syntax muted. */
const Tokens = ({ text }: { text: string }) =>
  text.split(TOKEN_RE).map((part, i) => {
    if (part === "") {
      return null;
    }
    const key = `${i}:${part}`;
    if (part.startsWith("<")) {
      const name = part.replace(TAG_OPEN_RE, "");
      return (
        <span key={key}>
          <span className="text-muted-foreground">
            {part.slice(0, part.length - name.length)}
          </span>
          {name}
        </span>
      );
    }
    if (part.startsWith('"') || part.startsWith("'")) {
      return (
        <span key={key}>
          <span className="text-muted-foreground">{part[0]}</span>
          <Words text={part.slice(1, -1)} />
          <span className="text-muted-foreground">{part.at(-1)}</span>
        </span>
      );
    }
    // The attributes' names and the punctuation; plain text between tags stays as it is.
    const quiet = i % 2 === 1 && QUIET_RE.test(part);
    return quiet ? (
      <span className="text-muted-foreground" key={key}>
        {part}
      </span>
    ) : (
      <Words key={key} text={part} />
    );
  });

/**
 * The code as lines that wrap: a long class list continues under the line's own start, a little
 * further in, so the tree's indentation still reads.
 */
const CodeLines = ({ code }: { code: string }) => (
  <div className="select-text font-code">
    {code.split("\n").map((line, i) => {
      const indent = line.length - line.trimStart().length;
      return (
        <div
          className="whitespace-pre-wrap [overflow-wrap:anywhere]"
          // biome-ignore lint/suspicious/noArrayIndexKey: the lines are the code's, in its order.
          key={i}
          style={{ paddingLeft: `${indent + 2}ch`, textIndent: "-2ch" }}
        >
          {line.trim() === "" ? "\u00a0" : <Tokens text={line.trimStart()} />}
        </div>
      );
    })}
  </div>
);

/** Copies the code; the icon says it was, for a moment. */
const CopyCode = ({ code }: { code: string | null }) => {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) {
      return;
    }
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);
  return (
    <IconButton
      className="text-muted-foreground"
      disabled={code === null}
      onClick={() => {
        if (code === null) {
          return;
        }
        navigator.clipboard.writeText(code).then(
          () => setCopied(true),
          (error: unknown) => reportError(error)
        );
      }}
      tooltip={copied ? "Copied" : "Copy code"}
    >
      {copied ? <Check /> : <Copy />}
    </IconButton>
  );
};

/**
 * The node the code is about — the one selected, or the root of the selected page — with the way
 * down to it: its parent's layout is what `fill` and `hug` are written against.
 */
const useSubject = () => {
  const selection = useEditor((s) => s.selection);
  const selectedPage = useEditor((s) => s.selectedPage);
  const canvas = useEditor((s) => s.canvas);
  const frame = selection?.frame ?? selectedPage;
  // The root is the stored document's own object, so the selector stays stable between renders.
  const root = useDocuments((s) =>
    frame ? rootOfFrame(s.docs, canvas, frame) : null
  );
  // A page without a URL is named after its file, as its URL would be; a view of a page is its
  // page's (ADR 0036).
  const route = useProject((s) => {
    const own = frame ? ownFrameOf(frame) : null;
    const page = s.pages.find((p) => p.id === own);
    return page ? (page.route ?? routeOf(page.path)) : undefined;
  });
  const path = root ? findPath(root, selection?.nodeId ?? root.id) : null;
  const node = path?.at(-1);
  if (!node) {
    return null;
  }
  const parent = path?.at(-2);
  return { canvas, node, parent, route } as const;
};

/**
 * The code the server writes for a node, through the project's style system; the last one
 * written stays on screen while the next is on its way, and goes when the next cannot be written.
 */
const useWritten = (request: {
  /** The canvas the node is in: a link to one of its pages is written as the page's URL. */
  readonly canvas: string | null;
  readonly component: string | undefined;
  readonly node: DesignNode | undefined;
  readonly parent: ParentLayout;
}) => {
  const { canvas, component, node, parent } = request;
  // A token's value changed: its class may be another; a component's file, its slots' layout;
  // a page's URL, the link to it.
  const designSystem = useDesignSystem((s) => s.designSystem);
  const components = useComponents((s) => s.components);
  const pages = useProject((s) => s.pages);
  const [code, setCode] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: the server writes with the design system and the pages it holds, so a change to them writes the code again.
  useEffect(() => {
    if (!node) {
      return;
    }
    let live = true;
    api()
      .request("code.write", {
        ...(canvas !== null && { canvas }),
        ...(component !== undefined && { component }),
        node,
        parent,
      })
      .then((written) => {
        if (live) {
          setCode(written.code);
          setFailed(false);
        }
      })
      .catch(() => {
        if (live) {
          // The last one written is another node's, or this one's as it was.
          setCode(null);
          setFailed(true);
        }
      });
    return () => {
      live = false;
    };
  }, [canvas, component, node, parent, designSystem, components, pages]);
  return { code, failed };
};

export const CodePanel = () => {
  const subject = useSubject();
  const catalogue = useComponents((s) => s.catalogue);
  const node = subject?.node;
  const parent = subject?.parent;
  const route = subject?.route;
  const component =
    node?.type === "page" && route !== undefined
      ? pageComponentName(route)
      : undefined;
  // Inside an instance, a node is sized against the layout of the slot it fills.
  let parentLayout: ParentLayout = "free";
  if (parent?.type === "instance" && node) {
    parentLayout = slotLayoutOf(parent, node.slot, catalogue) ?? "block";
  } else if (parent) {
    parentLayout = layoutOf(parent);
  }
  const { code, failed } = useWritten({
    canvas: subject?.canvas ?? null,
    component,
    node,
    parent: parentLayout,
  });
  if (!node) {
    return (
      <EmptyState icon={<CodeIcon />} title="Nothing selected">
        Select a layer to read it as code, with your components and classes.
      </EmptyState>
    );
  }
  return (
    <div className="flex flex-col pb-2">
      <div className="flex h-11 shrink-0 items-center gap-2 pr-2 pl-4">
        <div className="flex min-w-0 flex-1 items-baseline gap-2">
          <span className="truncate font-heading-xsmall">
            {nodeLabel(node)}
          </span>
          {nodeKind(node) === nodeLabel(node) ? null : (
            <span className="shrink-0 font-body-small text-muted-foreground">
              {nodeKind(node)}
            </span>
          )}
        </div>
        <CopyCode code={code} />
      </div>
      <div className="mx-2 rounded-lg bg-muted px-3 py-2.5">
        {code === null ? (
          <CodeWaiting failed={failed} />
        ) : (
          <CodeLines code={code} />
        )}
      </div>
    </div>
  );
};

/** While the code is written: the lines it will take; if it could not be, why. */
const CodeWaiting = ({ failed }: { failed: boolean }) =>
  failed ? (
    <p className="font-body-small text-muted-foreground">
      Couldn’t write the code. Select the layer again to retry.
    </p>
  ) : (
    <div aria-busy="true" className="flex flex-col gap-2 py-1">
      {["w-1/3", "w-5/6", "w-2/3", "w-3/4", "w-1/4"].map((width, i) => (
        <span
          className={`h-3 animate-pulse rounded-sm bg-foreground/8 ${width}`}
          // biome-ignore lint/suspicious/noArrayIndexKey: placeholders, in a fixed order.
          key={i}
          style={{ marginLeft: `${(i % 3) * 2}ch` }}
        />
      ))}
    </div>
  );
