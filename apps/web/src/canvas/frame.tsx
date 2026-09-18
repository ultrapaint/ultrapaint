import type {
  FrameLayout,
  Page,
  ViewportPreset,
} from "@ultrapaint/contracts/pages";
import type { HostError, HostMessage } from "@ultrapaint/contracts/preview";
import { PREVIEW_PROTOCOL } from "@ultrapaint/framework-api/protocol";
import { cn } from "cn";
import { AlertTriangle } from "lucide-react";
import {
  memo,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import { OptionSelect } from "../components/option-select.tsx";
import { api } from "../state/connection.ts";
import { useEditor } from "../state/editor.ts";
import { reportError, useProject } from "../state/project.ts";
import { findBySource, findNode, stepInto } from "../state/tree.ts";
import { bridgeFor, removeBridge } from "./bridge.ts";

const presets: { value: ViewportPreset; label: string }[] = [
  { label: "Mobile", value: "mobile" },
  { label: "Tablet", value: "tablet" },
  { label: "Desktop", value: "desktop" },
  { label: "Custom", value: "custom" },
];

const formatHostError = (error: HostError) => {
  if (!error.file) {
    return error.message;
  }
  const line = error.line ? `:${error.line}` : "";
  return `${error.message}\n${error.file}${line}`;
};

/** Writes an inline text edit from the host back to the source of the selected node. */
const commitText = (pageId: string, text: string) => {
  const store = useEditor.getState;
  const sel = store().selection;
  const node =
    sel?.pageId === pageId
      ? findBySource(store().trees[pageId], sel.source as never)
      : null;
  const source = node?.source ?? sel?.source ?? null;
  if (!source) {
    return;
  }
  api()
    .request("edit.apply", {
      op: { kind: "setText", target: source, text },
    })
    .then((r) => {
      if (r.location && sel) {
        store().select({ ...sel, source: r.location });
      }
    })
    .catch(reportError);
};

const isInteractive = (s: { mode: string; spacePan: boolean }) =>
  s.mode === "interact" && !s.spacePan;

interface Props {
  frame: FrameLayout;
  hostUrl: string | null;
  onDragStart: (
    e: ReactPointerEvent,
    pageId: string,
    kind: "move" | "resize"
  ) => void;
  page: Page;
  visible: boolean;
  zoom: number;
}

export const Frame = memo(
  ({ page, frame, hostUrl, zoom, visible, onDragStart }: Props) => {
    const iframeRef = useRef<HTMLIFrameElement>(null);
    const mode = useEditor((s) => s.mode);
    const spacePan = useEditor((s) => s.spacePan);
    const selection = useEditor((s) => s.selection);
    const hover = useEditor((s) => s.hover);
    const rects = useEditor((s) => s.rects[page.id]);
    const tree = useEditor((s) => s.trees[page.id]);
    const hostError = useEditor((s) => s.hostErrors[page.id]);
    const isActive = useEditor((s) => s.activePage === page.id);
    // One frame, one page: the canvas shows every route of the space at once, so a frame stays
    // on its own route and a link pressed inside it moves the editor, not the frame.
    const url = hostUrl
      ? `${hostUrl}/?space=${encodeURIComponent(page.space)}&route=${encodeURIComponent(page.route)}&frame=${encodeURIComponent(page.id)}`
      : null;
    const inv = 1 / zoom;

    // Bridge lifecycle. The bridge is looked up here and in handlers, never during render: the
    // registry is mutable (cleanup removes the entry), so a render-time lookup would be cached by
    // React Compiler and go stale.
    useEffect(() => {
      const iframe = iframeRef.current;
      if (!(iframe && visible && url)) {
        return;
      }
      const bridge = bridgeFor(page.id);
      bridge.attach(iframe);
      const store = useEditor.getState;
      const off = bridge.on((msg: HostMessage) => {
        switch (msg.type) {
          case "ed:ready":
            // A repository may pin its own framework package one day; an older preview
            // would then misread what the editor sends.
            if ((msg.protocol ?? PREVIEW_PROTOCOL) !== PREVIEW_PROTOCOL) {
              store().setHostError(
                page.id,
                `The preview speaks protocol ${msg.protocol}, the editor ${PREVIEW_PROTOCOL}. Update the framework package installed in the repository.`
              );
              break;
            }
            bridge.requestTree();
            if (Object.keys(store().tokens).length === 0) {
              bridge.requestTokens();
            }
            // A page that reloads (or arrives late) has to be told the current mode: it starts
            // out interactive so that a preview opened on its own still works.
            bridge.setInteractive(isInteractive(store()));
            store().setHostError(page.id, null);
            break;
          case "ed:tree":
            store().setTree(page.id, msg.tree);
            break;
          case "ed:rects":
            store().setRects(page.id, msg.rects);
            break;
          case "ed:hmr": {
            store().setHostError(page.id, null);
            bridge.requestTree();
            bridge.requestTokens();
            break;
          }
          case "ed:error":
            store().setHostError(page.id, formatHostError(msg.error));
            break;
          case "ed:tokens":
            store().setTokens(msg.tokens);
            break;
          case "ed:textCommit":
            commitText(page.id, msg.text);
            break;
          case "ed:navigateTo":
            // The frame keeps its page; the editor goes where the link pointed, which brings
            // the target frame's own preview forward.
            store().navigate(msg.route, { push: !msg.replace });
            break;
          default:
            break;
        }
      });
      return () => {
        off();
        removeBridge(page.id);
      };
    }, [page.id, visible, url]);

    // Outside interact mode the page is a picture: pointer events are off on the iframe, and
    // the runtime swallows whatever else could reach a component (keys sent to an element that
    // still holds focus, the click Enter synthesises on it).
    useEffect(() => {
      if (!(visible && url)) {
        return;
      }
      bridgeFor(page.id).setInteractive(mode === "interact" && !spacePan);
    }, [page.id, visible, url, mode, spacePan]);

    // Keep the selection attached to the same source after HMR (ids can change on remount).
    // Only once the node it names is gone: a source does not name one node. Every item of a
    // list is written once and rendered many times, and a library forwards the props of an
    // instance — and with them its stamp — all the way down to the element it renders, so
    // looking a selection up by its source again would answer with a different node than the
    // one that was just picked.
    useEffect(() => {
      if (
        !(tree && selection) ||
        selection.pageId !== page.id ||
        !selection.source ||
        findNode(tree, selection.nodeId)
      ) {
        return;
      }
      const node =
        findBySource(tree, selection.source, "component") ??
        findBySource(tree, selection.source);
      if (node && node.id !== selection.nodeId) {
        useEditor.getState().select({ ...selection, nodeId: node.id });
      }
    }, [tree, selection, page.id]);

    // Rect watching for hover + selection; re-sent whenever the tree changes (HMR remounts).
    useEffect(() => {
      if (!tree) {
        return;
      }
      const ids: string[] = [];
      if (selection?.pageId === page.id) {
        ids.push(selection.nodeId);
      }
      if (hover?.pageId === page.id) {
        ids.push(hover.nodeId);
      }
      bridgeFor(page.id).watchRects(ids);
    }, [page.id, selection, hover, tree]);

    // Pointer interaction in select mode.
    const lastHit = useRef(0);
    const toFrame = (e: ReactPointerEvent | ReactMouseEvent) => {
      const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
      return { x: (e.clientX - r.left) / zoom, y: (e.clientY - r.top) / zoom };
    };
    /** The node a pointer event at this position means, given what is selected. */
    const nodeAt = async (e: ReactPointerEvent | ReactMouseEvent) => {
      const { x, y } = toFrame(e);
      const chain = await bridgeFor(page.id).hitTest(x, y);
      const store = useEditor.getState();
      const selected =
        store.selection?.pageId === page.id ? store.selection.nodeId : null;
      return stepInto(chain, store.trees[page.id], selected, e.altKey);
    };
    const onMove = async (e: ReactPointerEvent) => {
      const now = performance.now();
      if (now - lastHit.current < 40) {
        return;
      }
      lastHit.current = now;
      const id = await nodeAt(e);
      const store = useEditor.getState();
      if (id) {
        store.setHover({ nodeId: id, pageId: page.id });
      } else if (store.hover?.pageId === page.id) {
        store.setHover(null);
      }
    };
    const select = (id: string) => {
      const store = useEditor.getState();
      const t = store.trees[page.id];
      const node = t ? findNode(t, id) : null;
      store.select({
        nodeId: id,
        pageId: page.id,
        source: node?.source ?? null,
      });
    };
    const onClick = async (e: ReactMouseEvent) => {
      // Keyboard activation (Enter/Space) has no pointer position to hit-test: it only picks
      // the frame, which is also what a click on nothing inside it means.
      if (e.detail === 0) {
        useEditor.getState().selectPage(page.id);
        return;
      }
      const id = await nodeAt(e);
      if (id) {
        select(id);
      } else {
        useEditor.getState().selectPage(page.id);
      }
    };
    const onDoubleClick = async (e: ReactMouseEvent) => {
      const { x, y } = toFrame(e);
      const bridge = bridgeFor(page.id);
      // Text is edited where it is written, whatever the two clicks before this selected.
      const id = (await bridge.hitTest(x, y)).at(-1);
      if (id) {
        select(id);
        bridge.editText(id);
      }
    };

    const onPointerLeave = () => {
      const s = useEditor.getState();
      if (s.hover?.pageId === page.id) {
        s.setHover(null);
      }
    };

    const selectedRect =
      selection?.pageId === page.id ? rects?.[selection.nodeId] : undefined;
    const hoverRect =
      hover?.pageId === page.id && hover.nodeId !== selection?.nodeId
        ? rects?.[hover.nodeId]
        : undefined;

    return (
      <div
        className="absolute"
        data-page={page.id}
        style={{
          height: frame.height,
          left: frame.x,
          top: frame.y,
          width: frame.width,
        }}
      >
        <FrameChrome
          frame={frame}
          inv={inv}
          isActive={isActive}
          onDragStart={onDragStart}
          page={page}
        />

        <div className="absolute inset-0 overflow-hidden bg-white shadow-2xl">
          {visible && url ? (
            <iframe
              className="block h-full w-full border-0 bg-white"
              ref={iframeRef}
              src={url}
              style={{
                pointerEvents:
                  mode === "interact" && !spacePan ? "auto" : "none",
              }}
              title={page.name}
            />
          ) : (
            <div className="flex h-full items-center justify-center text-zinc-500">
              {url ? "" : "Preview host not running"}
            </div>
          )}
          {mode === "select" && !spacePan && (
            <button
              aria-label={`Select elements in ${page.name}`}
              className="absolute inset-0 h-full w-full cursor-default"
              onClick={onClick}
              onDoubleClick={onDoubleClick}
              onPointerLeave={onPointerLeave}
              onPointerMove={onMove}
              type="button"
            />
          )}
          {hoverRect ? (
            <Outline inv={inv} kind="hover" rect={hoverRect} />
          ) : null}
          {selectedRect ? (
            <Outline inv={inv} kind="selection" rect={selectedRect} />
          ) : null}
          {hostError && (
            <div
              className="absolute inset-x-0 bottom-0 flex items-start gap-2 bg-destructive/90 p-3 font-mono text-[11px] text-white"
              style={{ fontSize: 11 * inv, padding: 12 * inv }}
            >
              <AlertTriangle className="size-4 shrink-0" />
              <pre className="whitespace-pre-wrap">{hostError}</pre>
            </div>
          )}
        </div>

        <div
          className="absolute cursor-nwse-resize rounded-sm bg-brand"
          onPointerDown={(e) => onDragStart(e, page.id, "resize")}
          style={{
            bottom: -6 * inv,
            height: 10 * inv,
            right: -6 * inv,
            width: 10 * inv,
          }}
        />
      </div>
    );
  }
);
Frame.displayName = "Frame";

/** Page name, viewport preset and size above the frame, plus the frame's selection outline. */
const FrameChrome = ({
  page,
  frame,
  inv,
  isActive,
  onDragStart,
}: Pick<Props, "frame" | "onDragStart" | "page"> & {
  inv: number;
  isActive: boolean;
}) => {
  const isSelected = useEditor((s) => s.selectedPage === page.id);
  const [titleHover, setTitleHover] = useState(false);
  const selectPage = () => useEditor.getState().selectPage(page.id);
  return (
    <>
      {/* Chrome: constant page size and distance from the frame regardless of zoom. */}
      <div
        className={cn(
          "absolute left-0 flex items-center gap-2 whitespace-nowrap",
          isSelected || isActive ? "text-foreground" : "text-muted-foreground"
        )}
        style={{
          bottom: `calc(100% + ${6 * inv}px)`,
          height: 26,
          transform: `scale(${inv})`,
          transformOrigin: "bottom left",
        }}
      >
        <button
          className={cn(
            "cursor-pointer select-none font-medium text-[12px] hover:text-foreground",
            isSelected && "text-brand hover:text-brand"
          )}
          onClick={selectPage}
          onPointerDown={(e) => onDragStart(e, page.id, "move")}
          onPointerEnter={() => setTitleHover(true)}
          onPointerLeave={() => setTitleHover(false)}
          type="button"
        >
          {page.name}
        </button>
        <div className="w-24">
          <OptionSelect
            className="border-transparent bg-transparent text-[11px] text-muted-foreground hover:border-input dark:bg-transparent"
            onChange={(v) =>
              useEditor.getState().setPreset(page.id, v as ViewportPreset)
            }
            options={presets}
            size="sm"
            value={frame.preset}
          />
        </div>
        <span className="text-[11px] text-muted-foreground">
          {Math.round(frame.width)} × {Math.round(frame.height)}
        </span>
      </div>
      {isSelected || titleHover ? (
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            outline: `${(isSelected ? 2 : 1) * inv}px solid ${isSelected ? "#4f8cff" : "rgba(79,140,255,0.6)"}`,
          }}
        />
      ) : null}
    </>
  );
};

const Outline = ({
  rect,
  inv,
  kind,
}: {
  rect: { x: number; y: number; width: number; height: number };
  inv: number;
  kind: "hover" | "selection";
}) => (
  <div
    className="pointer-events-none absolute"
    style={{
      height: rect.height,
      left: rect.x,
      outline: `${(kind === "selection" ? 2 : 1) * inv}px solid ${kind === "selection" ? "#4f8cff" : "rgba(79,140,255,0.6)"}`,
      outlineOffset: -1 * inv,
      top: rect.y,
      width: rect.width,
    }}
  >
    {kind === "selection" && (
      <span
        className="absolute left-1/2 rounded-sm bg-brand px-1 py-0.5 font-medium text-[10px] text-brand-foreground"
        style={{
          top: "100%",
          transform: `translate(-50%, ${4 * inv}px) scale(${inv})`,
          transformOrigin: "top center",
          whiteSpace: "nowrap",
        }}
      >
        {Math.round(rect.width)} × {Math.round(rect.height)}
      </span>
    )}
  </div>
);

export const useHostUrl = () =>
  useProject((s) =>
    s.info.host.state === "running" ? (s.info.host.url ?? null) : null
  );
