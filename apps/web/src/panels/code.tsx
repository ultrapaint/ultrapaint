/**
 * The selected node as code: JSX with the design system's components and Tailwind utilities,
 * everything under it included, by the rules an agent implements a page by. It is the reference
 * translation, for reading a design as code and seeing why it draws as it does; the
 * application's code is still written by an agent, in the repository's conventions.
 */
import { pageComponentName, toCode } from "@ultrapaint/design-document/code";
import { layoutOf, type ParentLayout } from "@ultrapaint/design-document/css";
import {
  findPath,
  nodeKind,
  nodeLabel,
} from "@ultrapaint/design-document/tree";
import { Markdown } from "../components/markdown.tsx";
import { PanelEmpty } from "../components/panel.tsx";
import { useDesignSystem } from "../state/design-system.ts";
import { rootOfFrame, useDocuments } from "../state/documents.ts";
import { useEditor } from "../state/editor.ts";
import { useInstances } from "../state/instances.ts";
import { useProject } from "../state/project.ts";

const BACKTICKS_RE = /`+/g;

/** A fence longer than any run of backticks the code holds, so text cannot close it. */
const fenced = (code: string, language: string) => {
  const longest = Math.max(
    0,
    ...Array.from(code.matchAll(BACKTICKS_RE), (m) => m[0].length)
  );
  const fence = "`".repeat(Math.max(3, longest + 1));
  return `${fence}${language}\n${code}\n${fence}`;
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
  const route = useProject(
    (s) => s.pages.find((page) => page.id === frame)?.route
  );
  const path = root ? findPath(root, selection?.nodeId ?? root.id) : null;
  const node = path?.at(-1);
  if (!node) {
    return null;
  }
  const parent = path?.at(-2);
  return { node, parent, route } as const;
};

export const CodePanel = () => {
  const subject = useSubject();
  const designSystem = useDesignSystem((s) => s.designSystem);
  const instances = useInstances((s) => s.drawn);
  if (!subject) {
    return (
      <PanelEmpty>
        Select a node on the canvas or in the layers panel to see its code
      </PanelEmpty>
    );
  }
  const { node, parent, route } = subject;
  const component =
    node.type === "page" && route !== undefined
      ? pageComponentName(route)
      : undefined;
  // Inside an instance, a node is sized against the layout its component was drawn with.
  let parentLayout: ParentLayout = "free";
  if (parent?.type === "instance") {
    parentLayout = instances[parent.id]?.layout ?? "block";
  } else if (parent) {
    parentLayout = layoutOf(parent);
  }
  const code = toCode(node, designSystem, {
    component,
    instances,
    parent: parentLayout,
  });
  return (
    <div className="flex flex-col gap-2 px-3 py-2.5">
      <div className="flex min-w-0 items-baseline gap-2">
        <span className="truncate font-semibold text-sm">
          {nodeLabel(node)}
        </span>
        {nodeKind(node) === nodeLabel(node) ? null : (
          <span className="shrink-0 text-[11px] text-muted-foreground">
            {nodeKind(node)}
          </span>
        )}
      </div>
      <p className="text-[11px] text-muted-foreground">
        The node and everything in it, as Tailwind and your components, by the
        rules agents implement a design with. Links are written as plain
        anchors; the application uses its router's.
      </p>
      <Markdown codeBlockMaxHeight="none">{fenced(code, "tsx")}</Markdown>
    </div>
  );
};
