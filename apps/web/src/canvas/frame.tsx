import type { HostError, HostMessage } from "@ultrapaint/contracts/preview";
import type {
  FrameLayout,
  Screen,
  ViewportPreset,
} from "@ultrapaint/contracts/screens";
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
import { findBySource, useEditor } from "../state/editor.ts";
import { reportError, useProject } from "../state/project.ts";
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
const commitText = (screenId: string, text: string) => {
  const store = useEditor.getState;
  const sel = store().selection;
  const node =
    sel?.screenId === screenId
      ? findBySource(store().trees[screenId], sel.source as never)
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
    screenId: string,
    kind: "move" | "resize"
  ) => void;
  screen: Screen;
  visible: boolean;
  zoom: number;
}

export const Frame = memo(
  ({ screen, frame, hostUrl, zoom, visible, onDragStart }: Props) => {
    const iframeRef = useRef<HTMLIFrameElement>(null);
    const mode = useEditor((s) => s.mode);
    const spacePan = useEditor((s) => s.spacePan);
    const selection = useEditor((s) => s.selection);
    const hover = useEditor((s) => s.hover);
    const rects = useEditor((s) => s.rects[screen.id]);
    const tree = useEditor((s) => s.trees[screen.id]);
    const hostError = useEditor((s) => s.hostErrors[screen.id]);
    const isActive = useEditor((s) => s.activeScreen === screen.id);
    const url = hostUrl
      ? `${hostUrl}/?screen=${encodeURIComponent(screen.id)}`
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
      const bridge = bridgeFor(screen.id);
      bridge.attach(iframe);
      const store = useEditor.getState;
      const off = bridge.on((msg: HostMessage) => {
        switch (msg.type) {
          case "ed:ready":
            // A repository may pin its own framework package one day; an older preview
            // would then misread what the editor sends.
            if ((msg.protocol ?? PREVIEW_PROTOCOL) !== PREVIEW_PROTOCOL) {
              store().setHostError(
                screen.id,
                `The preview speaks protocol ${msg.protocol}, the editor ${PREVIEW_PROTOCOL}. Update the framework package installed in the repository.`
              );
              break;
            }
            bridge.requestTree();
            if (Object.keys(store().tokens).length === 0) {
              bridge.requestTokens();
            }
            // A screen that reloads (or arrives late) has to be told the current mode: it starts
            // out interactive so that a preview opened on its own still works.
            bridge.setInteractive(isInteractive(store()));
            store().setHostError(screen.id, null);
            break;
          case "ed:tree":
            store().setTree(screen.id, msg.tree);
            break;
          case "ed:rects":
            store().setRects(screen.id, msg.rects);
            break;
          case "ed:hmr": {
            store().setHostError(screen.id, null);
            bridge.requestTree();
            bridge.requestTokens();
            break;
          }
          case "ed:error":
            store().setHostError(screen.id, formatHostError(msg.error));
            break;
          case "ed:tokens":
            store().setTokens(msg.tokens);
            break;
          case "ed:textCommit":
            commitText(screen.id, msg.text);
            break;
          default:
            break;
        }
      });
      return () => {
        off();
        removeBridge(screen.id);
      };
    }, [screen.id, visible, url]);

    // Outside interact mode the screen is a picture: pointer events are off on the iframe, and
    // the runtime swallows whatever else could reach a component (keys sent to an element that
    // still holds focus, the click Enter synthesises on it).
    useEffect(() => {
      if (!(visible && url)) {
        return;
      }
      bridgeFor(screen.id).setInteractive(mode === "interact" && !spacePan);
    }, [screen.id, visible, url, mode, spacePan]);

    // Keep the selection attached to the same source after HMR (ids can change on remount).
    useEffect(() => {
      if (
        !(tree && selection) ||
        selection.screenId !== screen.id ||
        !selection.source
      ) {
        return;
      }
      const node =
        findBySource(tree, selection.source, "component") ??
        findBySource(tree, selection.source);
      if (node && node.id !== selection.nodeId) {
        useEditor.getState().select({ ...selection, nodeId: node.id });
      }
    }, [tree, selection, screen.id]);

    // Rect watching for hover + selection; re-sent whenever the tree changes (HMR remounts).
    useEffect(() => {
      if (!tree) {
        return;
      }
      const ids: string[] = [];
      if (selection?.screenId === screen.id) {
        ids.push(selection.nodeId);
      }
      if (hover?.screenId === screen.id) {
        ids.push(hover.nodeId);
      }
      bridgeFor(screen.id).watchRects(ids);
    }, [screen.id, selection, hover, tree]);

    // Pointer interaction in select mode.
    const lastHit = useRef(0);
    const toFrame = (e: ReactPointerEvent | ReactMouseEvent) => {
      const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
      return { x: (e.clientX - r.left) / zoom, y: (e.clientY - r.top) / zoom };
    };
    const onMove = async (e: ReactPointerEvent) => {
      const now = performance.now();
      if (now - lastHit.current < 40) {
        return;
      }
      lastHit.current = now;
      const { x, y } = toFrame(e);
      const id = await bridgeFor(screen.id).hitTest(x, y, e.altKey);
      const store = useEditor.getState();
      if (id) {
        store.setHover({ nodeId: id, screenId: screen.id });
      } else if (store.hover?.screenId === screen.id) {
        store.setHover(null);
      }
    };
    const onClick = async (e: ReactMouseEvent) => {
      // Keyboard activation (Enter/Space) has no pointer position to hit-test: it only activates the screen.
      if (e.detail === 0) {
        useEditor.getState().setActiveScreen(screen.id);
        return;
      }
      const { x, y } = toFrame(e);
      const id = await bridgeFor(screen.id).hitTest(x, y, e.altKey);
      const store = useEditor.getState();
      store.setActiveScreen(screen.id);
      if (!id) {
        store.select(null);
        return;
      }
      const t = store.trees[screen.id];
      const node = t ? findNode(t, id) : null;
      store.select({
        nodeId: id,
        screenId: screen.id,
        source: node?.source ?? null,
      });
    };
    const onDoubleClick = async (e: ReactMouseEvent) => {
      const { x, y } = toFrame(e);
      const bridge = bridgeFor(screen.id);
      const id = await bridge.hitTest(x, y, true);
      if (id) {
        bridge.editText(id);
      }
    };

    const onPointerLeave = () => {
      const s = useEditor.getState();
      if (s.hover?.screenId === screen.id) {
        s.setHover(null);
      }
    };

    const selectedRect =
      selection?.screenId === screen.id ? rects?.[selection.nodeId] : undefined;
    const hoverRect =
      hover?.screenId === screen.id && hover.nodeId !== selection?.nodeId
        ? rects?.[hover.nodeId]
        : undefined;

    return (
      <div
        className="absolute"
        data-screen={screen.id}
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
          screen={screen}
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
              title={screen.name}
            />
          ) : (
            <div className="flex h-full items-center justify-center text-zinc-500">
              {url ? "" : "Preview host not running"}
            </div>
          )}
          {mode === "select" && !spacePan && (
            <button
              aria-label={`Select elements in ${screen.name}`}
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
          onPointerDown={(e) => onDragStart(e, screen.id, "resize")}
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

/** Screen name, viewport preset and size above the frame, plus the frame's selection outline. */
const FrameChrome = ({
  screen,
  frame,
  inv,
  isActive,
  onDragStart,
}: Pick<Props, "frame" | "onDragStart" | "screen"> & {
  inv: number;
  isActive: boolean;
}) => {
  const isSelected = useEditor((s) => s.selectedScreen === screen.id);
  const [titleHover, setTitleHover] = useState(false);
  const selectScreen = () => useEditor.getState().selectScreen(screen.id);
  return (
    <>
      {/* Chrome: constant screen size and distance from the frame regardless of zoom. */}
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
          onClick={selectScreen}
          onPointerDown={(e) => onDragStart(e, screen.id, "move")}
          onPointerEnter={() => setTitleHover(true)}
          onPointerLeave={() => setTitleHover(false)}
          type="button"
        >
          {screen.name}
        </button>
        <div className="w-24">
          <OptionSelect
            className="border-transparent bg-transparent text-[11px] text-muted-foreground hover:border-input dark:bg-transparent"
            onChange={(v) =>
              useEditor.getState().setPreset(screen.id, v as ViewportPreset)
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

const findNode = (
  tree: import("@ultrapaint/contracts/preview").TreeNode,
  id: string
): import("@ultrapaint/contracts/preview").TreeNode | null => {
  if (tree.id === id) {
    return tree;
  }
  for (const c of tree.children) {
    const r = findNode(c, id);
    if (r) {
      return r;
    }
  }
  return null;
};

export const useHostUrl = () =>
  useProject((s) =>
    s.info.host.state === "running" ? (s.info.host.url ?? null) : null
  );
