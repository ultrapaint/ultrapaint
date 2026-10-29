/**
 * The frame a system component is drawn in, as the system components see it: where their popups go (the frame's
 * body, inside its shadow root, so a dialog's backdrop covers this page only), the frame's host
 * (what an event from inside it carries on its path) and whether the frame runs (the prototype,
 * interact mode) or is designed.
 *
 * Designing, what is open is the design's (an overlay's `open` prop) and nothing the user does
 * changes it; the frame is inert besides, so nothing in it takes focus or the pointer. Running,
 * a system component starts from what the design says and its behaviour is Base UI's, kept to its own
 * frame: a press, a focus or an Escape from another frame or from the editor closes nothing.
 */
import {
  createContext,
  createElement,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";

export interface ComponentFrame {
  /** Where popups are portalled: the frame's body. */
  readonly container: HTMLElement | null;
  /** The frame's host: an event from inside the frame has it on its path. */
  readonly host: HTMLElement | null;
  /** The frame runs: the prototype, interact mode. */
  readonly interactive: boolean;
}

const NO_FRAME: ComponentFrame = {
  container: null,
  host: null,
  interactive: false,
};

const FrameContext = createContext<ComponentFrame>(NO_FRAME);

export const ComponentFrameProvider = ({
  children,
  frame,
}: {
  readonly children?: ReactNode;
  readonly frame: ComponentFrame;
}) => createElement(FrameContext.Provider, { value: frame }, children);

export const useComponentFrame = () => useContext(FrameContext);

/** The attribute every frame's host carries (preview-core's `data-ed-frame-host`). */
const FRAME_HOST_ATTRIBUTE = "data-ed-frame-host";

/** The frame host on an event's path, or null for the editor's own page. */
const hostOf = (event: Event): Element | null => {
  for (const target of event.composedPath()) {
    if (
      target instanceof Element &&
      target.hasAttribute(FRAME_HOST_ATTRIBUTE)
    ) {
      return target;
    }
  }
  return null;
};

/**
 * The frame the user last pressed or focused in, or null for the editor. Every open popup hears
 * Escape on the document, whichever frame it is in; only the active frame's act on it.
 */
let activeHost: Element | null = null;
let tracking = false;
const track = () => {
  if (tracking || typeof document === "undefined") {
    return;
  }
  tracking = true;
  const note = (event: Event) => {
    activeHost = hostOf(event);
  };
  document.addEventListener("pointerdown", note, true);
  document.addEventListener("focusin", note, true);
};

/** What Base UI says with a change of a popup's open state. */
export interface ChangeDetails {
  cancel: () => void;
  readonly event?: Event | undefined;
  readonly reason: string;
}

const SCOPED_REASONS: ReadonlySet<string> = new Set([
  "outside-press",
  "focus-out",
  "escape-key",
]);

/** Whether a dismissal comes from outside the frame: another frame, or the editor itself. */
const fromOutside = (host: HTMLElement, details: ChangeDetails) => {
  if (!SCOPED_REASONS.has(details.reason)) {
    return false;
  }
  if (details.reason === "escape-key") {
    return activeHost !== host;
  }
  const { event } = details;
  if (!event) {
    return false;
  }
  if (details.reason === "focus-out") {
    const next = (event as FocusEvent).relatedTarget;
    return !(
      next instanceof Node &&
      (host.contains(next) || host.shadowRoot?.contains(next))
    );
  }
  return !event.composedPath().includes(host);
};

/**
 * An overlay's open state. Designed, it is the design's `open`. Running, it starts from it, the
 * system component's own from then on, and only what happens in its frame closes it.
 */
export const useOverlayOpen = (designed: boolean | undefined) => {
  const { host, interactive } = useComponentFrame();
  const wanted = designed === true;
  const [open, setOpen] = useState(wanted);
  useEffect(() => {
    track();
  }, []);
  // Starting to run, or the design changing, starts again from what the design says.
  // biome-ignore lint/correctness/useExhaustiveDependencies: a frame that starts or stops running starts again from the design
  useEffect(() => setOpen(wanted), [interactive, wanted]);
  const onOpenChange = useCallback(
    (next: boolean, details: ChangeDetails) => {
      if (!interactive) {
        details.cancel();
        return;
      }
      if (!next && host && fromOutside(host, details)) {
        details.cancel();
        return;
      }
      setOpen(next);
    },
    [host, interactive]
  );
  return { interactive, onOpenChange, open: interactive ? open : wanted };
};
