/**
 * The selection's bar, docked above the tools at the bottom centre (ADR 0055): the controls of what
 * is selected, in the same place at every zoom and never over the design. On the canvas the
 * selection keeps only its name and the agent's button.
 */
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { create } from "zustand";

/** Where the bar is drawn: the slot above the tools, once it is in the page. */
const useSlot = create<{ el: HTMLElement | null }>(() => ({ el: null }));

const setSlot = (el: HTMLElement | null) => useSlot.setState({ el });

/** The slot above the tools that the selection's bar is drawn in; it takes no room while empty. */
export const SelectionDockSlot = () => (
  <div className="flex justify-center empty:hidden" ref={setSlot} />
);

/** A divider between the bar's groups, as the tools' own. */
export const Divider = () => (
  <span aria-hidden className="mx-1 h-5 w-px shrink-0 bg-input" />
);

/** The bar, in the slot above the tools: drawn from the frame, so it is a portal. */
export const SelectionDock = ({
  children,
  label,
}: {
  children: ReactNode;
  label: string;
}) => {
  const slot = useSlot((s) => s.el);
  return slot
    ? createPortal(
        <div
          aria-label={label}
          className="floating pointer-events-auto flex h-10 items-center gap-0.5 whitespace-nowrap p-1"
          data-element-toolbar
          // The bar is the frame's in React: a press on it is not a press on the canvas.
          onPointerDown={(e) => e.stopPropagation()}
          role="toolbar"
        >
          {children}
        </div>,
        slot
      )
    : null;
};
