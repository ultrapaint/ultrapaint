"use client";

/**
 * A tooltip that costs nothing until it is wanted. The trigger is the element it is given, with
 * a few handlers added; Base UI's tooltip (its root, positioner and popup) is mounted beside it,
 * anchored to it, only once a mouse rests on it or the keyboard focuses it, and goes when the
 * tooltip has closed. It is never mounted around the trigger, so the trigger is never mounted
 * again and keeps its focus. An inspector or a toolbar with a tooltip on each button draws a
 * selection without one of them.
 */
import { Tooltip as TooltipPrimitive } from "@base-ui/react/tooltip";
import {
  cloneElement,
  createContext,
  type Dispatch,
  type HTMLAttributes,
  type ReactElement,
  type ReactNode,
  type SetStateAction,
  use,
  useEffect,
  useState,
} from "react";
import { cn } from "@/lib/cn";

/** How long a mouse rests on a trigger before its tooltip opens, as the provider says. */
const DelayContext = createContext(0);

/** How soon after a tooltip closes the next one opens at once, as Base UI's provider has it. */
const GROUP_TIMEOUT = 400;

/**
 * The tooltip open, and when the last one closed: one opening closes it, and opens at once while
 * another is open or has just closed.
 */
const group: { open: { readonly close: () => void } | null; shutAt: number } = {
  open: null,
  shutAt: Number.NEGATIVE_INFINITY,
};

function TooltipProvider({
  delay = 0,
  children,
}: {
  children?: ReactNode;
  delay?: number;
}) {
  return <DelayContext value={delay}>{children}</DelayContext>;
}

interface Shown {
  /** The trigger it is shown at; null while it is not wanted. */
  readonly anchor: HTMLElement | null;
  readonly open: boolean;
}

interface Control {
  readonly close: () => void;
  readonly closed: () => void;
  readonly show: (anchor: HTMLElement, delay: number) => void;
  readonly shown: Shown;
}

const TooltipContext = createContext<Control | null>(null);

const useControl = (part: string) => {
  const control = use(TooltipContext);
  if (!control) {
    throw new Error(`${part} must be inside a <Tooltip>`);
  }
  return control;
};

const HIDDEN: Shown = { anchor: null, open: false };

/** What opens and closes one tooltip, beside the others of the group. */
const controlOf = (setShown: Dispatch<SetStateAction<Shown>>) => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const self = {
    close: () => {
      if (self.shut()) {
        setShown((s) => ({ ...s, open: false }));
      }
    },
    // Its exit played: Base UI's parts go until it is wanted again.
    closed: () => setShown((s) => (s.open ? s : HIDDEN)),
    show: (anchor: HTMLElement, delay: number) => {
      clearTimeout(timer);
      const open = () => {
        if (group.open !== self) {
          group.open?.close();
          group.open = self;
        }
        setShown({ anchor, open: true });
      };
      const near =
        group.open !== null || performance.now() - group.shutAt < GROUP_TIMEOUT;
      if (delay <= 0 || near) {
        open();
      } else {
        timer = setTimeout(open, delay);
      }
    },
    /** Leaves the group when it is the one open; what is drawn is the caller's. */
    shut: () => {
      clearTimeout(timer);
      if (group.open !== self) {
        return false;
      }
      group.open = null;
      group.shutAt = performance.now();
      return true;
    },
  };
  return self;
};

function Tooltip({ children }: { children?: ReactNode }) {
  const [shown, setShown] = useState<Shown>(HIDDEN);
  const [actions] = useState(() => controlOf(setShown));
  // A trigger that goes while its tooltip is open (the selection moved) leaves the group.
  useEffect(
    () => () => {
      actions.shut();
    },
    [actions]
  );
  return (
    <TooltipContext value={{ ...actions, shown }}>{children}</TooltipContext>
  );
}

type Handler<E> = ((event: E) => void) | undefined;

/** The element's own handler, then the tooltip's. */
const both =
  <E,>(own: Handler<E>, ours: (event: E) => void) =>
  (event: E) => {
    own?.(event);
    ours(event);
  };

function TooltipTrigger({
  render,
  children,
}: {
  children?: ReactNode;
  /** The element that shows the tooltip, given as it is: the tooltip only adds handlers to it. */
  render: ReactElement<HTMLAttributes<HTMLElement>>;
}) {
  const { close, show } = useControl("TooltipTrigger");
  const delay = use(DelayContext);
  const own = render.props;
  const props: HTMLAttributes<HTMLElement> = {
    onBlur: both(own.onBlur, close),
    // The keyboard's focus shows it, as Base UI's does; a press's does not.
    onFocus: both(own.onFocus, (event) => {
      if (event.currentTarget.matches(":focus-visible")) {
        show(event.currentTarget, 0);
      }
    }),
    onPointerDown: both(own.onPointerDown, close),
    // A mouse resting on it, not a touch.
    onPointerEnter: both(own.onPointerEnter, (event) => {
      if (event.pointerType !== "touch") {
        show(event.currentTarget, delay);
      }
    }),
    onPointerLeave: both(own.onPointerLeave, close),
  };
  return cloneElement(
    render,
    props,
    ...(children === undefined ? [] : [children])
  );
}

function TooltipContent({
  className,
  side = "top",
  sideOffset = 4,
  align = "center",
  alignOffset = 0,
  children,
  ...props
}: TooltipPrimitive.Popup.Props &
  Pick<
    TooltipPrimitive.Positioner.Props,
    "align" | "alignOffset" | "side" | "sideOffset"
  >) {
  const { close, closed, shown } = useControl("TooltipContent");
  if (!shown.anchor) {
    return null;
  }
  return (
    <TooltipPrimitive.Root
      onOpenChange={(open) => {
        // Escape, as Base UI's tooltip hears it.
        if (!open) {
          close();
        }
      }}
      onOpenChangeComplete={(open) => {
        if (!open) {
          closed();
        }
      }}
      open={shown.open}
    >
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Positioner
          align={align}
          alignOffset={alignOffset}
          anchor={shown.anchor}
          className="isolate z-50"
          side={side}
          sideOffset={sideOffset}
        >
          <TooltipPrimitive.Popup
            className={cn(
              "data-[side=bottom]:slide-in-from-top-2 data-[side=inline-end]:slide-in-from-left-2 data-[side=inline-start]:slide-in-from-right-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-[state=delayed-open]:fade-in-0 data-[state=delayed-open]:zoom-in-95 data-open:fade-in-0 data-open:zoom-in-95 data-closed:fade-out-0 data-closed:zoom-out-95 z-50 inline-flex w-fit max-w-xs origin-(--transform-origin) items-center gap-1.5 rounded-md bg-foreground px-2 py-1 font-body-small text-background shadow-overlay has-data-[slot=kbd]:pr-1 data-[state=delayed-open]:animate-in data-closed:animate-out data-open:animate-in **:data-[slot=kbd]:relative **:data-[slot=kbd]:isolate **:data-[slot=kbd]:z-50 **:data-[slot=kbd]:rounded-sm dark:bg-popover dark:text-popover-foreground dark:ring-1 dark:ring-border",
              className
            )}
            data-slot="tooltip-content"
            {...props}
          >
            {children}
          </TooltipPrimitive.Popup>
        </TooltipPrimitive.Positioner>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}

export { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger };
