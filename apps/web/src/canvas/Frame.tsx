import type { FrameLayout, HostMessage, Screen, ViewportPreset } from "@ultrapaint/contracts";
import { AlertTriangle } from "lucide-react";
import * as React from "react";
import { OptionSelect } from "../components/option-select.tsx";
import { cn } from "../lib/utils.ts";
import { api } from "../state/connection.ts";
import { findBySource, useEditor } from "../state/editor.ts";
import { reportError, useProject } from "../state/project.ts";
import { bridgeFor, removeBridge } from "./bridge.ts";

const presets: { value: ViewportPreset; label: string }[] = [
  { value: "mobile", label: "Mobile" },
  { value: "tablet", label: "Tablet" },
  { value: "desktop", label: "Desktop" },
  { value: "custom", label: "Custom" },
];

interface Props {
  screen: Screen;
  frame: FrameLayout;
  hostUrl: string | null;
  zoom: number;
  visible: boolean;
  onDragStart: (e: React.PointerEvent, kind: "move" | "resize") => void;
}

export const Frame = React.memo(({ screen, frame, hostUrl, zoom, visible, onDragStart }: Props) => {
  const iframeRef = React.useRef<HTMLIFrameElement>(null);
  const mode = useEditor((s) => s.mode);
  const selection = useEditor((s) => s.selection);
  const hover = useEditor((s) => s.hover);
  const rects = useEditor((s) => s.rects[screen.id]);
  const tree = useEditor((s) => s.trees[screen.id]);
  const hostError = useEditor((s) => s.hostErrors[screen.id]);
  const isActive = useEditor((s) => s.activeScreen === screen.id);
  const bridge = bridgeFor(screen.id);
  const url = hostUrl ? `${hostUrl}/?screen=${encodeURIComponent(screen.id)}` : null;
  const inv = 1 / zoom;

  // Bridge lifecycle.
  React.useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe || !visible) return;
    bridge.attach(iframe);
    const store = useEditor.getState;
    const off = bridge.on((msg: HostMessage) => {
      switch (msg.type) {
        case "ed:ready":
          bridge.requestTree();
          if (Object.keys(store().tokens).length === 0) bridge.requestTokens();
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
          store().setHostError(
            screen.id,
            `${msg.error.message}${msg.error.file ? `\n${msg.error.file}${msg.error.line ? `:${msg.error.line}` : ""}` : ""}`,
          );
          break;
        case "ed:tokens":
          store().setTokens(msg.tokens);
          break;
        case "ed:textCommit": {
          const sel = store().selection;
          const node =
            sel?.screenId === screen.id
              ? findBySource(store().trees[screen.id], sel.source as never)
              : null;
          const source = node?.source ?? sel?.source ?? null;
          if (!source) return;
          api()
            .request("edit.apply", { op: { kind: "setText", target: source, text: msg.text } })
            .then((r) => {
              if (r.location && sel) store().select({ ...sel, source: r.location });
            })
            .catch(reportError);
          break;
        }
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
  React.useEffect(() => {
    if (!tree || !selection || selection.screenId !== screen.id || !selection.source) return;
    const node =
      findBySource(tree, selection.source, "component") ?? findBySource(tree, selection.source);
    if (node && node.id !== selection.nodeId)
      useEditor.getState().select({ ...selection, nodeId: node.id });
  }, [tree, selection, screen.id]);

  // Rect watching for hover + selection.
  React.useEffect(() => {
    const ids: string[] = [];
    if (selection?.screenId === screen.id) ids.push(selection.nodeId);
    if (hover?.screenId === screen.id) ids.push(hover.nodeId);
    bridge.watchRects(ids);
  }, [bridge, screen.id, selection, hover, tree]);

  // Pointer interaction in select mode.
  const lastHit = React.useRef(0);
  const toFrame = (e: React.PointerEvent | React.MouseEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    return { x: (e.clientX - r.left) / zoom, y: (e.clientY - r.top) / zoom };
  };
  const onMove = async (e: React.PointerEvent) => {
    const now = performance.now();
    if (now - lastHit.current < 40) return;
    lastHit.current = now;
    const { x, y } = toFrame(e);
    const id = await bridge.hitTest(x, y, e.altKey);
    const store = useEditor.getState();
    if (id) store.setHover({ screenId: screen.id, nodeId: id });
    else if (store.hover?.screenId === screen.id) store.setHover(null);
  };
  const onClick = async (e: React.MouseEvent) => {
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
    store.select({ screenId: screen.id, nodeId: id, source: node?.source ?? null });
  };
  const onDoubleClick = async (e: React.MouseEvent) => {
    const { x, y } = toFrame(e);
    const id = await bridge.hitTest(x, y, true);
    if (id) bridge.editText(id);
  };

  const selectedRect = selection?.screenId === screen.id ? rects?.[selection.nodeId] : undefined;
  const hoverRect =
    hover?.screenId === screen.id && hover.nodeId !== selection?.nodeId
      ? rects?.[hover.nodeId]
      : undefined;

  return (
    <div
      className="absolute"
      style={{ left: frame.x, top: frame.y, width: frame.width, height: frame.height }}
      data-screen={screen.id}
    >
      {/* Chrome: constant screen size regardless of zoom. */}
      <div
        className={cn(
          "absolute left-0 flex items-center gap-2 whitespace-nowrap",
          isActive ? "text-foreground" : "text-muted-foreground",
        )}
        style={{
          top: -30 * inv,
          transform: `scale(${inv})`,
          transformOrigin: "bottom left",
          height: 26,
        }}
      >
        <button
          type="button"
          className="cursor-grab select-none font-medium text-[12px] hover:text-foreground active:cursor-grabbing"
          onPointerDown={(e) => onDragStart(e, "move")}
          onClick={() => useEditor.getState().setActiveScreen(screen.id)}
        >
          {screen.name}
        </button>
        <div className="w-24">
          <OptionSelect
            size="sm"
            value={frame.preset}
            options={presets}
            onChange={(v) => useEditor.getState().setPreset(screen.id, v as ViewportPreset)}
            className="border-transparent bg-transparent text-[11px] text-muted-foreground hover:border-input dark:bg-transparent"
          />
        </div>
        <span className="text-[11px] text-muted-foreground">
          {Math.round(frame.width)} × {Math.round(frame.height)}
        </span>
      </div>

      <div
        className={cn(
          "absolute inset-0 overflow-hidden bg-white shadow-2xl",
          isActive && "ring-1 ring-brand/60",
        )}
      >
        {visible && url ? (
          <iframe
            ref={iframeRef}
            title={screen.name}
            src={url}
            className="block h-full w-full border-0 bg-white"
            style={{ pointerEvents: mode === "interact" ? "auto" : "none" }}
          />
        ) : (
          <div className="flex h-full items-center justify-center text-zinc-500">
            {url ? "" : "Preview host not running"}
          </div>
        )}
        {mode === "select" && (
          <div
            className="absolute inset-0 cursor-default"
            onPointerMove={onMove}
            onPointerLeave={() => {
              const s = useEditor.getState();
              if (s.hover?.screenId === screen.id) s.setHover(null);
            }}
            onClick={onClick}
            onDoubleClick={onDoubleClick}
          />
        )}
        {hoverRect && <Outline rect={hoverRect} inv={inv} kind="hover" />}
        {selectedRect && <Outline rect={selectedRect} inv={inv} kind="selection" />}
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
        style={{ right: -6 * inv, bottom: -6 * inv, width: 10 * inv, height: 10 * inv }}
        onPointerDown={(e) => onDragStart(e, "resize")}
      />
    </div>
  );
});
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
      left: rect.x,
      top: rect.y,
      width: rect.width,
      height: rect.height,
      outline: `${(kind === "selection" ? 2 : 1) * inv}px solid ${kind === "selection" ? "#4f8cff" : "rgba(79,140,255,0.6)"}`,
      outlineOffset: -1 * inv,
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
  tree: import("@ultrapaint/contracts").TreeNode,
  id: string,
): import("@ultrapaint/contracts").TreeNode | null => {
  if (tree.id === id) return tree;
  for (const c of tree.children) {
    const r = findNode(c, id);
    if (r) return r;
  }
  return null;
};

export const useHostUrl = () =>
  useProject((s) => (s.info.host.state === "running" ? (s.info.host.url ?? null) : null));
