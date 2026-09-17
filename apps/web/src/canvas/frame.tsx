import type { HostError, HostMessage } from "@ultrapaint/contracts/preview";
import type {
  FrameLayout,
  Screen,
  ViewportPreset,
} from "@ultrapaint/contracts/screens";
import { cn } from "cn";
import { AlertTriangle } from "lucide-react";
import {
  memo,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useRef,
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

interface Props {
  frame: FrameLayout;
  hostUrl: string | null;
  onDragStart: (e: ReactPointerEvent, kind: "move" | "resize") => void;
  screen: Screen;
  visible: boolean;
  zoom: number;
}

export const Frame = memo(
  ({ screen, frame, hostUrl, zoom, visible, onDragStart }: Props) => {
    const iframeRef = useRef<HTMLIFrameElement>(null);
    const mode = useEditor((s) => s.mode);
    const selection = useEditor((s) => s.selection);
    const hover = useEditor((s) => s.hover);
    const rects = useEditor((s) => s.rects[screen.id]);
    const tree = useEditor((s) => s.trees[screen.id]);
    const hostError = useEditor((s) => s.hostErrors[screen.id]);
    const isActive = useEditor((s) => s.activeScreen === screen.id);
    const bridge = bridgeFor(screen.id);
    const url = hostUrl
      ? `${hostUrl}/?screen=${encodeURIComponent(screen.id)}`
      : null;
    const inv = 1 / zoom;

    // Bridge lifecycle.
    useEffect(() => {
      const iframe = iframeRef.current;
      if (!(iframe && visible)) {
        return;
      }
      bridge.attach(iframe);
      const store = useEditor.getState;
      const off = bridge.on((msg: HostMessage) => {
        switch (msg.type) {
          case "ed:ready":
            bridge.requestTree();
            if (Object.keys(store().tokens).length === 0) {
              bridge.requestTokens();
            }
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
    }, [bridge, screen.id, visible]);

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
      bridge.watchRects(ids);
    }, [bridge, screen.id, selection, hover, tree]);

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
      const id = await bridge.hitTest(x, y, e.altKey);
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
      const id = await bridge.hitTest(x, y, e.altKey);
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
      const id = await bridge.hitTest(x, y, true);
      if (id) {
        bridge.editText(id);
      }
    };

    const onPointerLeave = useCallback(() => {
      const s = useEditor.getState();
      if (s.hover?.screenId === screen.id) {
        s.setHover(null);
      }
    }, [screen.id]);
    const onActivate = useCallback(
      () => useEditor.getState().setActiveScreen(screen.id),
      [screen.id]
    );
    const onMoveStart = useCallback(
      (e: ReactPointerEvent) => onDragStart(e, "move"),
      [onDragStart]
    );
    const onResizeStart = useCallback(
      (e: ReactPointerEvent) => onDragStart(e, "resize"),
      [onDragStart]
    );
    const onPresetChange = useCallback(
      (v: string) =>
        useEditor.getState().setPreset(screen.id, v as ViewportPreset),
      [screen.id]
    );

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
        {/* Chrome: constant screen size regardless of zoom. */}
        <div
          className={cn(
            "absolute left-0 flex items-center gap-2 whitespace-nowrap",
            isActive ? "text-foreground" : "text-muted-foreground"
          )}
          style={{
            height: 26,
            top: -30 * inv,
            transform: `scale(${inv})`,
            transformOrigin: "bottom left",
          }}
        >
          <button
            className="cursor-grab select-none font-medium text-[12px] hover:text-foreground active:cursor-grabbing"
            onClick={onActivate}
            onPointerDown={onMoveStart}
            type="button"
          >
            {screen.name}
          </button>
          <div className="w-24">
            <OptionSelect
              className="border-transparent bg-transparent text-[11px] text-muted-foreground hover:border-input dark:bg-transparent"
              onChange={onPresetChange}
              options={presets}
              size="sm"
              value={frame.preset}
            />
          </div>
          <span className="text-[11px] text-muted-foreground">
            {Math.round(frame.width)} × {Math.round(frame.height)}
          </span>
        </div>

        <div
          className={cn(
            "absolute inset-0 overflow-hidden bg-white shadow-2xl",
            isActive && "ring-1 ring-brand/60"
          )}
        >
          {visible && url ? (
            <iframe
              className="block h-full w-full border-0 bg-white"
              ref={iframeRef}
              src={url}
              style={{ pointerEvents: mode === "interact" ? "auto" : "none" }}
              title={screen.name}
            />
          ) : (
            <div className="flex h-full items-center justify-center text-zinc-500">
              {url ? "" : "Preview host not running"}
            </div>
          )}
          {mode === "select" && (
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
          onPointerDown={onResizeStart}
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
