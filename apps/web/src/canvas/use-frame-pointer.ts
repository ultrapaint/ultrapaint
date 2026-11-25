/**
 * The pointer in a frame in select and comment mode: hover, click and double-click, a press that
 * becomes a drag or a marquee (followed to its release by `pointer-gesture.ts`, ADR 0133), a
 * right-click's menu, and a comment placed where the page is clicked.
 */
import type { DesignNode } from "@ultrapaint/contracts/document";
import type { Rect } from "@ultrapaint/contracts/preview";
import { isLayerOf } from "@ultrapaint/design-document/instance-layers";
import { childrenOf, isContainer } from "@ultrapaint/design-document/tree";
import {
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
} from "react";
import { picksInside, picksWith, togglePick } from "../state/canvas-picks.ts";
import { holdMenu, openMenuAt, showMenu } from "../state/context-menu.ts";
import {
  appFileOf,
  nodeIn,
  rootOfFrame,
  useDocuments,
} from "../state/documents.ts";
import { useEditor } from "../state/editor.ts";
import { frameRefOf, takesComments } from "../state/frame-ref.ts";
import {
  leaveForHeld,
  leaveIsolation,
  useIsolation,
} from "../state/isolation.ts";
import {
  isSelected,
  select,
  selectedIn,
  selectForMenu,
  selectMany,
  selectPage,
  toggleSelected,
} from "../state/selection.ts";
import { allFrames } from "../state/surface.ts";
import { stepInto } from "../state/tree.ts";
import { placeComment } from "./comments.tsx";
import {
  beginDrag,
  cancelDrag,
  canvasPoint,
  type Dragged,
  endDrag,
  moveDrag,
  useDrag,
} from "./drag.ts";
import { frameOf } from "./editor-frame.ts";
import { hitUnlocked } from "./hit-test.ts";
import { useMeasureKey } from "./measure-key.ts";
import {
  afterGesture,
  followPointer,
  isFollowing,
  putBackGesture,
} from "./pointer-gesture.ts";
import { holdsFree } from "./snap.ts";

/** Where a pointer event was, on the element it was heard on. */
export type PointerAt = Pick<
  ReactPointerEvent,
  "clientX" | "clientY" | "currentTarget"
>;

/** How far the pointer travels before a press becomes a drag, in screen pixels. */
const DRAG_THRESHOLD = 4;

/** The node a drag carries, when it carries one that is already in a document. */
const draggedId = (target: Dragged): string | null => {
  if (target.kind === "node") {
    return target.node.id;
  }
  return target.kind === "loose" ? target.nodeId : null;
};

const intersects = (a: Rect, b: Rect) =>
  a.x < b.x + b.width &&
  b.x < a.x + a.width &&
  a.y < b.y + b.height &&
  b.y < a.y + a.height;

const contains = (outer: Rect, inner: Rect) =>
  inner.x >= outer.x &&
  inner.y >= outer.y &&
  inner.x + inner.width <= outer.x + outer.width &&
  inner.y + inner.height <= outer.y + outer.height;

/**
 * Forgets what the pointer hovers over in a frame: the pointer left the frame, or the layer it
 * hovered over went away under it.
 */
export const leaveHover = (frameId: string) => {
  const s = useEditor.getState();
  if (s.hover?.frame === frameId) {
    s.setHover(null);
  }
};

/**
 * Whether a click goes straight to the innermost node under it: Alt, or Ctrl/⌘ as in Figma, an
 * instance's layers included (ADR 0114).
 */
export const deep = (e: {
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
}) => e.altKey || e.ctrlKey || e.metaKey;

/** The pointer's handlers for a frame's select and comment layers, and the marquee being drawn. */
export const useFramePointer = ({
  canvas,
  frame,
  frameId,
  root,
}: {
  canvas: string | null;
  /** Where the frame is on the canvas, which a node dragged off it starts from. */
  frame: { x: number; y: number };
  /**
   * A page's frame or a view of it, a node placed on the canvas (which a drag of its root moves
   * about), or a board's frame an app component is edited in place in (ADR 0045), which stays
   * where its board is: its id says which.
   */
  frameId: string;
  root: DesignNode | null;
}) => {
  const ref = frameRefOf(frameId);
  const kind = ref.kind === "view" ? "page" : ref.kind;
  // Pointer interaction in select mode.
  const lastHit = useRef(0);
  /** Where the pointer rests over the select layer, which ⌥ pressed hit-tests again. */
  const resting = useRef<PointerAt | null>(null);
  /**
   * The select layer taken away under a resting pointer (Space held, another mode) sends no
   * pointerleave, and the hover would stay drawn: the layer calls this as it goes.
   */
  const onSelectLayerGone = () => {
    resting.current = null;
    leaveHover(frameId);
  };
  /**
   * The select layer back under a resting pointer (the hand put down, the select tool picked):
   * what it is over is hovered at once, as a move there would hover it.
   */
  const onSelectLayerBack = (at: PointerAt) => {
    resting.current = at;
    rehover(useMeasureKey.getState().deep);
  };
  const toFrame = (e: PointerAt) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    // The zoom the frame is drawn at: read when the pointer acts, so a zoom redraws no frame.
    const { zoom } = useEditor.getState().view;
    return { x: (e.clientX - r.left) / zoom, y: (e.clientY - r.top) / zoom };
  };
  const currentRoot = () =>
    rootOfFrame(
      useDocuments.getState().docs,
      useEditor.getState().canvas,
      frameId
    );
  /**
   * The node a point of the frame means, given what is selected: the innermost there when
   * `innermost`.
   */
  const nodeUnder = (
    { x, y }: { x: number; y: number },
    innermost: boolean
  ) => {
    const chain = hitUnlocked(frameId, x, y);
    const [selected = null] = selectedIn(frameId);
    return stepInto(chain, currentRoot(), selected, innermost, appFileOf);
  };
  /** The node a pointer event at this position means, given what is selected. */
  const nodeAt = (e: ReactPointerEvent | ReactMouseEvent) =>
    nodeUnder(toFrame(e), deep(e));
  /**
   * In a component edited in place, what a click goes on to past the component's innermost node
   * under it: what that node's slot holds there, the page's own or a level around's (ADR 0123).
   * Reached once that node is selected, or at once with Ctrl/⌘ or Alt; null while the click
   * stays in the component.
   */
  const heldAt = (e: ReactMouseEvent) => {
    const { x, y } = toFrame(e);
    const innermost = hitUnlocked(frameId, x, y).at(-1);
    // A locked node cuts the chain short: what it holds is not reached either.
    if (
      innermost === undefined ||
      frameOf(frameId).hitTest(x, y).at(-1) !== innermost
    ) {
      return null;
    }
    const held = frameOf(frameId).pageAt(x, y);
    const [selected = null] = selectedIn(frameId);
    return held.length > 0 && (deep(e) || selected === innermost) ? held : null;
  };
  /**
   * A click in the component edited in this frame that leaves it, which it does: on the page
   * dimmed around it, where nothing is hit, or past a slot's node, on to what the slot holds
   * (ADR 0123). Whether it left.
   */
  const leavesComponent = (e: ReactMouseEvent, id: string | null) => {
    if (id === null) {
      return leaveIsolation();
    }
    const held = heldAt(e);
    return held !== null && leaveForHeld(held, deep(e));
  };
  const hoverOn = (id: string | null) => {
    const store = useEditor.getState();
    if (id) {
      store.setHover({ frame: frameId, nodeId: id });
    } else if (store.hover?.frame === frameId) {
      store.setHover(null);
    }
  };
  const onMove = (e: ReactPointerEvent) => {
    const now = performance.now();
    if (now - lastHit.current < 40) {
      return;
    }
    lastHit.current = now;
    hoverOn(nodeAt(e));
  };
  // ⌥ pressed or let go with the pointer at rest: what it is over is the innermost node there
  // at once, to measure to (ADR 0131), and the one a click would select again once let go,
  // the innermost still while Ctrl or ⌘ is held.
  /** Whether a hit-test waits for the gesture under way to end. */
  const waitsForGesture = useRef<boolean>(false);
  const rehover = (innermost: boolean) => {
    const at = resting.current;
    if (at === null) {
      return;
    }
    // A gesture under way keeps what it is about, a pan or a press of this frame's or another's:
    // where the pointer rests is hit-tested once it ends, with the keys held then.
    if (isFollowing()) {
      if (!waitsForGesture.current) {
        waitsForGesture.current = true;
        afterGesture(() => {
          waitsForGesture.current = false;
          rehover(useMeasureKey.getState().deep);
        });
      }
      return;
    }
    hoverOn(nodeUnder(toFrame(at), innermost));
  };
  const hitAgain = useEffectEvent((innermost: boolean) => rehover(innermost));
  useEffect(
    () =>
      useMeasureKey.subscribe((now, before) => {
        if (now.held !== before.held) {
          hitAgain(now.deep);
        }
      }),
    []
  );
  const selectId = (id: string) => select({ frame: frameId, nodeId: id });
  const selectFrame = () => {
    if (kind === "page") {
      selectPage(frameId);
    } else if (root && !root.locked) {
      select({ frame: frameId, nodeId: root.id });
    } else {
      select(null);
    }
  };
  const onClick = (e: ReactMouseEvent) => {
    // Keyboard activation (Enter/Space) has no pointer position to hit-test: it only picks
    // the frame, which is also what a click on nothing inside it means.
    if (e.detail === 0) {
      selectFrame();
      return;
    }
    // A component edited in place is left by a click outside it: in another frame, or on the
    // page dimmed around it, where nothing is hit. Its edits are saved as they are made.
    const editing = useIsolation.getState().isolated?.frame;
    if (editing !== undefined && editing !== frameId) {
      leaveIsolation();
    }
    // With frames picked as wholes, Shift or ⌘/Ctrl adds this one to them, or takes it out.
    if (picksWith(e) && editing === undefined && picksInside(frameId)) {
      togglePick(frameId);
      return;
    }
    const id = nodeAt(e);
    if (editing === frameId && leavesComponent(e, id)) {
      return;
    }
    if (id && e.shiftKey) {
      toggleSelected({ frame: frameId, nodeId: id });
    } else if (id) {
      selectId(id);
    } else {
      selectFrame();
    }
  };
  const onDoubleClick = (e: ReactMouseEvent) => {
    const { x, y } = toFrame(e);
    // Text is edited where it is written, whatever the two clicks before this selected, a layer
    // of an instance's too. A double-click only goes deeper: the main component is opened by
    // asking for it (ADR 0114).
    const id = hitUnlocked(frameId, x, y).at(-1);
    const node = id
      ? nodeIn(useDocuments.getState().docs, canvas, frameId, id)
      : null;
    if (id && node?.type === "text") {
      selectId(id);
      frameOf(frameId).editText(id);
    }
  };

  /**
   * What a press or a right-click here is about: what is selected, when the point is inside
   * it, else what a click would select. A page's root selected is the page (ADR 0075): a press
   * inside it is about what is under the pointer.
   */
  const pickAt = (x: number, y: number, alt: boolean) => {
    const chain = hitUnlocked(frameId, x, y);
    const [selected = null] = selectedIn(frameId);
    const pageSelected = kind === "page" && selected === currentRoot()?.id;
    return selected !== null && !pageSelected && chain.includes(selected)
      ? selected
      : stepInto(chain, currentRoot(), selected, alt, appFileOf);
  };

  /**
   * What a press here picks up if it turns into a drag: what `pickAt` says. On a node placed on
   * the canvas, its root is the node itself, and dragging it moves it around the canvas.
   */
  const dragTarget = (x: number, y: number, alt: boolean): Dragged | null => {
    const id = pickAt(x, y, alt);
    const store = useEditor.getState();
    const current = currentRoot();
    if (!(id && current)) {
      return null;
    }
    if (kind === "node" && id === current.id) {
      return {
        frame: frameId,
        kind: "loose",
        nodeId: id,
        origin: { x: frame.x, y: frame.y },
      };
    }
    // A layer of an instance is moved in its main component, never on the page (ADR 0114).
    if (id === current.id || isLayerOf(current, id)) {
      return null;
    }
    const rect = frameOf(frameId).measure([id])[id];
    const node = nodeIn(
      useDocuments.getState().docs,
      store.canvas,
      frameId,
      id
    );
    if (!(rect && node)) {
      return null;
    }
    return { frame: frameId, kind: "node", node, rect };
  };

  /**
   * A drag from the page itself, or from a container that is not selected, draws a marquee in
   * it, as in Figma: a selected node, or a text, a picture or a component, is dragged instead.
   */
  const [marquee, setMarquee] = useState<Rect | null>(null);
  /** Whether the last press travelled, dragging or drawing: the click that ends it is no click. */
  const dragging = useRef<boolean>(false);
  /** Whether a press here is the gesture followed now. */
  const pressing = useRef<boolean>(false);
  // A frame taken off the canvas mid-press (its page gone, a board closed) leaves nothing of the
  // press following the pointer.
  useEffect(
    () => () => {
      if (pressing.current) {
        putBackGesture();
      }
    },
    []
  );

  /**
   * A press, followed from here to its release or until it is put back (`pointer-gesture.ts`,
   * ADR 0133), wherever the pointer goes and though the select layer goes under it (Space held).
   * It stays a click until it travels; then it drags what it is on, or draws a marquee. What it
   * picks up is found then: a press that stays a click hit-tests and measures nothing more than
   * the click does.
   */
  const onPointerDown = (e: ReactPointerEvent) => {
    if (e.button !== 0) {
      return;
    }
    // A gesture still followed (its release never came) is put back before anything of this press
    // is read: what this one starts from is where that one left things, not where it drew them.
    putBackGesture();
    const layer = e.currentTarget as HTMLElement;
    /** Where the frame's corner is on the canvas, as last seen. */
    let corner = { x: 0, y: 0 };
    /**
     * A point of the canvas in the frame, where the frame is now: by its layer, or while the layer
     * is gone (Space held) by the frame's box, which a layout pushed meanwhile may have moved.
     */
    const inFrame = (p: { x: number; y: number }) => {
      if (layer.isConnected) {
        const box = layer.getBoundingClientRect();
        corner = canvasPoint(box.left, box.top);
      } else {
        corner = allFrames()[frameId] ?? corner;
      }
      return { x: p.x - corner.x, y: p.y - corner.y };
    };
    const press = { alt: e.altKey, x: e.clientX, y: e.clientY };
    /** Where the press began on the canvas: the marquee's fixed corner, wherever the frame goes. */
    const pressedAt = canvasPoint(e.clientX, e.clientY);
    /** Where it began in the frame, which what it picks up is found at. */
    const at = inFrame(pressedAt);
    /** What the press has become: still a click, a drag, a marquee in a node, or nothing. */
    let doing: "click" | "drag" | "marquee" | "nothing" = "click";
    /** The node a marquee is drawn in, by its id: read from its document when it is let go. */
    let within: string | null = null;
    /** The marquee as the pointer last drew it, and the frame that will show it. */
    let rect: Rect | null = null;
    let request: number | null = null;
    /** Where the pointer last was in the window, which the marquee reaches to. */
    let pointer: { x: number; y: number } | null = null;
    /** The marquee to `pointer`, through the view as it is now and the frame where it is now. */
    const reach = (): Rect | null => {
      if (!pointer) {
        return null;
      }
      const from = inFrame(pressedAt);
      const to = inFrame(canvasPoint(pointer.x, pointer.y));
      return {
        height: Math.abs(to.y - from.y),
        width: Math.abs(to.x - from.x),
        x: Math.min(from.x, to.x),
        y: Math.min(from.y, to.y),
      };
    };
    const redraw = () => {
      rect = reach();
      // Drawn once a frame, however often the pointer reports.
      request ??= requestAnimationFrame(() => {
        request = null;
        setMarquee(rect);
      });
    };
    const draw = (clientX: number, clientY: number) => {
      pointer = { x: clientX, y: clientY };
      redraw();
    };
    /** The view moved or the frame was laid out again under a still pointer: drawn again. */
    let following: (() => void) | null = null;
    const followView = () => {
      following = useEditor.subscribe((now, before) => {
        if (now.view !== before.view || now.frames !== before.frames) {
          redraw();
        }
      });
    };
    const putAway = () => {
      following?.();
      following = null;
      if (request !== null) {
        cancelAnimationFrame(request);
        request = null;
      }
      setMarquee(null);
    };
    /** The press has travelled: what it is on is dragged, or a marquee is drawn from it. */
    const travel = (ev: PointerEvent) => {
      dragging.current = true;
      const target = dragTarget(at.x, at.y, press.alt);
      if (!target) {
        doing = kind === "page" ? "marquee" : "nothing";
        within = currentRoot()?.id ?? null;
      } else if (
        target.kind === "node" &&
        isContainer(target.node) &&
        !isSelected(frameId, target.node.id)
      ) {
        doing = "marquee";
        within = target.node.id;
      } else {
        doing = "drag";
        // What is dragged is what is selected, as it would be after a click on it.
        const id = draggedId(target);
        if (id && useEditor.getState().selection?.nodeId !== id) {
          selectId(id);
        }
        beginDrag(target, press.x, press.y, ev.altKey, holdsFree(ev));
      }
      // What the pointer was over as it pressed is not what a marquee is about: nothing is
      // hovered, or measured with ⌥, while one is drawn.
      if (doing === "marquee") {
        leaveHover(frameId);
        followView();
      }
      move(ev);
    };
    const move = (ev: PointerEvent) => {
      if (doing === "marquee") {
        draw(ev.clientX, ev.clientY);
      } else if (doing === "drag") {
        moveDrag(ev.clientX, ev.clientY, ev.altKey, holdsFree(ev));
      } else if (
        doing === "click" &&
        Math.hypot(ev.clientX - press.x, ev.clientY - press.y) >= DRAG_THRESHOLD
      ) {
        travel(ev);
      }
    };
    dragging.current = false;
    followPointer(e, {
      // Put back: what is dragged goes back where it was, and a marquee selects nothing.
      cancel: () => {
        pressing.current = false;
        if (doing === "marquee") {
          putAway();
        } else if (doing === "drag" && useDrag.getState().dragged) {
          cancelDrag();
        }
      },
      move,
      up: () => {
        pressing.current = false;
        if (doing === "marquee") {
          putAway();
          // Measured again: the view may have moved under a pointer that has not since.
          const area = reach();
          // Read as its document has it now: a node locked or taken away meanwhile is not picked.
          const container =
            within === null
              ? null
              : nodeIn(
                  useDocuments.getState().docs,
                  useEditor.getState().canvas,
                  frameId,
                  within
                );
          if (area && container) {
            selectInMarquee(area, container);
          }
        } else if (doing === "drag" && useDrag.getState().dragged) {
          endDrag();
        }
      },
    });
    pressing.current = true;
    // Kept from the frames the pointer crosses while it drags: their hover would show.
    layer.setPointerCapture(e.pointerId);
  };
  /** The hover, while no gesture follows the pointer: this frame's, another's or the canvas's. */
  const onPointerMove = (e: ReactPointerEvent) => {
    // Kept through a press too: ⌥ pressed once it is let go hit-tests where the pointer is.
    resting.current = {
      clientX: e.clientX,
      clientY: e.clientY,
      currentTarget: e.currentTarget,
    };
    if (!isFollowing()) {
      onMove(e);
    }
  };

  /**
   * What a marquee drawn in `within` selects: the children of it that it touches. When it touches
   * only one and does not cover it whole, that one's children instead: the way a designer means
   * the nodes the rectangle is drawn across.
   */
  const selectInMarquee = (area: Rect, within: DesignNode) => {
    let level = childrenOf(within);
    for (;;) {
      const measured = frameOf(frameId).measure(level.map((n) => n.id));
      const hits = level.filter((n) => {
        const r = measured[n.id];
        return r !== undefined && !n.locked && intersects(r, area);
      });
      const [only] = hits;
      const box = only ? measured[only.id] : undefined;
      // One child touched and not covered whole: what the rectangle is about is inside it.
      if (
        hits.length === 1 &&
        only &&
        box &&
        !contains(area, box) &&
        childrenOf(only).length > 0
      ) {
        level = childrenOf(only);
        continue;
      }
      selectMany(hits.map((n) => ({ frame: frameId, nodeId: n.id })));
      return;
    }
  };
  const onSelectClick = (e: ReactMouseEvent) => {
    // The click that ends a drag is not a click.
    if (dragging.current) {
      dragging.current = false;
      return;
    }
    onClick(e);
  };

  /**
   * Places a comment where the frame was clicked, on the innermost node there: a page's (or a
   * view's), or a node's beside the pages, which moves with it (ADR 0097).
   */
  const onPlaceComment = (e: ReactMouseEvent) => {
    if (takesComments(ref)) {
      placeComment(frameId, toFrame(e));
    }
  };

  /**
   * A right-click selects what it is on, as a click would, and opens that node's menu; on
   * nothing but the page, the page's. What is selected stays selected when it is clicked in.
   */
  const onContextMenu = (e: ReactMouseEvent) => {
    const anchor = holdMenu(e);
    const at = toFrame(e);
    const id = pickAt(at.x, at.y, e.altKey);
    const current = currentRoot();
    if (id && current && (kind === "node" || id !== current.id)) {
      selectForMenu({ frame: frameId, nodeId: id });
      showMenu({ at, frame: frameId, kind: "node", nodeId: id }, anchor);
    } else if (kind === "page") {
      selectPage(frameId);
      showMenu({ at, kind: "page", pageId: frameId }, anchor);
    } else if (current) {
      selectForMenu({ frame: frameId, nodeId: current.id });
      showMenu(
        { at, frame: frameId, kind: "node", nodeId: current.id },
        anchor
      );
    }
  };
  /** In comment mode, a page's menu on a page, and on a node beside the pages its own. */
  const onCommentContextMenu = (e: ReactMouseEvent) => {
    if (kind === "page") {
      selectPage(frameId);
      openMenuAt(e, { at: toFrame(e), kind: "page", pageId: frameId });
      return;
    }
    onContextMenu(e);
  };

  const onPointerLeave = () => {
    resting.current = null;
    leaveHover(frameId);
  };

  return {
    marquee,
    onCommentContextMenu,
    onContextMenu,
    onDoubleClick,
    onPlaceComment,
    onPointerDown,
    onPointerLeave,
    onPointerMove,
    onSelectClick,
    onSelectLayerBack,
    onSelectLayerGone,
  };
};
