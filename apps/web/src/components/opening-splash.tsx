/**
 * The splash a project opens on (ADR 0099), from the click until its editor is ready: the
 * lockup, the project and where it is, a bar from its last open, every step with its time, and
 * Cancel. Past the estimate it says so, with the last line the step printed; over SSH the log is
 * a click away; a step that fails stays with why, and Try again. The pointer paints while it
 * waits (`PaintLayer`), and the bar is painted by the brush of the mark, whose bristles' tip is
 * the stroke's end. It draws an `Opening`: the desktop app's (the shell bridge's `opening`), or
 * the editor's own in a browser.
 */
import {
  currentStep,
  type Opening,
  type OpeningStep,
} from "@ultrapaint/contracts/opening";
import {
  Circle,
  CircleAlert,
  CircleCheck,
  Copy,
  LoaderCircle,
} from "lucide-react";
import { type RefObject, useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/cn";
import { BRUSH_WITHOUT_TIP, Lockup } from "./logo.tsx";
import { PaintLayer } from "./paint-layer.tsx";

/** Before this long the splash shows the project alone: a quick open shows no bar to jump. */
const SETTLE_MS = 500;
/** A step at work longer than this shows the last line it printed. */
const LINE_AFTER_MS = 1000;
/** The bar stops short of its end until the open is done. */
const BAR_MAX = 0.96;

/** The time now, a tick at a time while `running`. */
const useNow = (running: boolean) => {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) {
      return;
    }
    const tick = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(tick);
  }, [running]);
  return now;
};

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;

/** How long a step took, or has taken so far. */
const stepTime = (step: OpeningStep, now: number) =>
  step.ms ?? (step.since === undefined ? undefined : now - step.since);

const StepIcon = ({ state }: { readonly state: OpeningStep["state"] }) => {
  const className = "size-3.5 shrink-0";
  switch (state) {
    case "done":
      return <CircleCheck className={className} />;
    case "now":
      return (
        <LoaderCircle className={cn(className, "motion-safe:animate-spin")} />
      );
    case "failed":
      return <CircleAlert className={cn(className, "text-destructive")} />;
    default:
      return <Circle className={className} />;
  }
};

/**
 * The bar, a stroke of paint the brush lays: wettest behind the bristles, drier along it, its
 * end cut on the slant of the bristles' tip, which the brush stands over with a 1px cut between.
 * The brush is the mark without its tip, turned −15.19° so that cut lies level, at 0.4592px a
 * unit, which makes the tip the bar's 6px.
 */
const BrushBar = ({ fraction }: { readonly fraction: number }) => {
  const id = useId().replaceAll(":", "");
  const tip = fraction * 440;
  const at = `${(fraction * 100).toFixed(2)}%`;
  return (
    <div aria-hidden className="relative h-3.5">
      <div className="absolute inset-x-0 top-1 h-1.5 rounded-full bg-foreground/10" />
      <div
        className="absolute inset-0 text-foreground motion-safe:transition-[clip-path] motion-safe:duration-100 motion-safe:ease-linear"
        style={{
          clipPath: `polygon(0 0, calc(${at} + 6.89px) 0, calc(${at} - 1.93px) 100%, 0 100%)`,
        }}
      >
        <svg
          aria-hidden="true"
          className="block size-full"
          preserveAspectRatio="none"
          viewBox="0 0 440 14"
        >
          <defs>
            <linearGradient
              gradientUnits="userSpaceOnUse"
              id={`${id}-wet`}
              x1={tip - 150}
              x2={Math.max(tip, 1)}
              y1="0"
              y2="0"
            >
              <stop offset="0" stopColor="currentColor" stopOpacity="0.6" />
              <stop offset="1" stopColor="currentColor" stopOpacity="1" />
            </linearGradient>
            <linearGradient
              gradientUnits="userSpaceOnUse"
              id={`${id}-sheen`}
              x1={tip - 70}
              x2={Math.max(tip, 1)}
              y1="0"
              y2="0"
            >
              <stop offset="0" stopColor="#fff" stopOpacity="0" />
              <stop offset="0.75" stopColor="#fff" stopOpacity="1" />
              <stop offset="1" stopColor="#fff" stopOpacity="0" />
            </linearGradient>
          </defs>
          <path
            d="M3 7 C 120 6.8, 300 7.2, 437 7"
            fill="none"
            stroke={`url(#${id}-wet)`}
            strokeLinecap="round"
            strokeWidth="6"
          />
          <path
            d="M6 5.3 C 90 4.9, 170 5.6, 250 5.1 S 390 5.4, 434 5.2"
            fill="none"
            opacity="0.5"
            stroke={`url(#${id}-wet)`}
            strokeLinecap="round"
            strokeWidth="1"
          />
          <path
            d="M4 8.8 C 70 9.2, 180 8.5, 260 9 S 400 8.6, 436 8.8"
            fill="none"
            opacity="0.45"
            stroke={`url(#${id}-wet)`}
            strokeLinecap="round"
            strokeWidth="1"
          />
          <path
            className="motion-safe:animate-splash-wet motion-reduce:opacity-0"
            d="M5 5.6 C 80 5.2, 160 5.9, 240 5.4 S 380 5.7, 435 5.5"
            fill="none"
            stroke={`url(#${id}-sheen)`}
            strokeLinecap="round"
            strokeWidth="1.4"
          />
        </svg>
      </div>
      <div
        className="absolute top-0 size-0 text-foreground motion-safe:transition-[left] motion-safe:duration-100 motion-safe:ease-linear"
        style={{ left: at }}
      >
        <svg
          aria-hidden="true"
          className="absolute overflow-visible"
          style={{ height: 33.52, left: -13.32, top: -23.41, width: 26.63 }}
          viewBox="9 -17 58 73"
        >
          <path
            d={BRUSH_WITHOUT_TIP}
            fill="currentColor"
            transform="rotate(-15.188)"
          />
        </svg>
      </div>
    </div>
  );
};

/** The log, as it was printed: what ssh and the server said, to read or copy. */
const LogBox = ({ lines }: { readonly lines: readonly string[] }) => (
  <div className="relative rounded-lg border bg-card py-2 pr-9 pl-3">
    <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all font-code text-muted-foreground">
      {lines.length > 0 ? lines.join("\n") : "Nothing printed yet."}
    </pre>
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            aria-label="Copy log"
            className="absolute top-1 right-1 text-muted-foreground"
            onClick={() => {
              navigator.clipboard
                ?.writeText(lines.join("\n"))
                .catch(() => undefined);
            }}
            size="icon-sm"
            variant="ghost"
          />
        }
      >
        <Copy />
      </TooltipTrigger>
      <TooltipContent>Copy log</TooltipContent>
    </Tooltip>
  </div>
);

/** Where the bar is: none without an estimate or once failed, its end once done. */
const barAt = (opening: Opening, elapsed: number, done: boolean) => {
  if (opening.estimate === undefined || opening.problem) {
    return null;
  }
  if (done) {
    return 1;
  }
  return Math.min(BAR_MAX, elapsed / Math.max(opening.estimate, 1));
};

/** What the line under the bar says. */
const timeLeft = (estimate: number, elapsed: number, done: boolean) => {
  if (done) {
    return "Ready";
  }
  if (elapsed > estimate) {
    return `Longer than last time (${Math.round(estimate / 1000)} s)`;
  }
  return `About ${Math.max(1, Math.round((estimate - elapsed) / 1000))} s left`;
};

/** A step: its state, its label, its time; the line it printed; why it failed. */
const StepRow = ({
  now,
  opening,
  step,
}: {
  readonly now: number;
  readonly opening: Opening;
  readonly step: OpeningStep;
}) => {
  const time = stepTime(step, now);
  const active = step.state === "now" || step.state === "failed";
  const showLine =
    step.state === "now" &&
    step.line !== undefined &&
    time !== undefined &&
    time > LINE_AFTER_MS;
  return (
    <li className="flex flex-col">
      <div
        className={cn(
          "flex h-7 items-center gap-2",
          active
            ? "font-body-medium text-foreground"
            : "font-body text-muted-foreground"
        )}
      >
        <StepIcon state={step.state} />
        <span className="min-w-0 flex-1 truncate">{step.label}</span>
        {time === undefined || step.state === "next" ? null : (
          <span className="font-body-small text-muted-foreground tabular-nums">
            {seconds(time)}
          </span>
        )}
      </div>
      {showLine ? (
        // On the label's edge: the icon's 14px and the 8px gap before the label.
        <p className="truncate pl-5.5 font-code text-muted-foreground">
          {step.line}
        </p>
      ) : null}
      {step.state === "failed" && opening.problem ? (
        <div className="mt-1 mb-2 flex flex-col gap-0.5 rounded-lg bg-destructive/10 p-3">
          <p className="font-body-medium text-destructive">
            {opening.problem.reason}
          </p>
          {opening.problem.hint ? (
            <p className="font-body">{opening.problem.hint}</p>
          ) : null}
        </div>
      ) : null}
    </li>
  );
};

/**
 * What ends the wait, at the right, rising to Try again; the log's toggle, a utility, alone at
 * the left. None in a browser's local open, where there is nothing to do.
 */
const Footer = ({
  log,
  onCancel,
  onRetry,
}: {
  readonly log: { readonly shown: boolean; readonly toggle: () => void } | null;
  readonly onCancel: (() => void) | undefined;
  readonly onRetry: (() => void) | undefined;
}) =>
  log || onCancel || onRetry ? (
    <footer className="flex items-center gap-2">
      {log ? (
        <Button onClick={log.toggle} variant="ghost">
          {log.shown ? "Hide log" : "Show log"}
        </Button>
      ) : null}
      <span className="flex-1" />
      {onCancel ? (
        <Button onClick={onCancel} variant="outline">
          Cancel
        </Button>
      ) : null}
      {onRetry ? <Button onClick={onRetry}>Try again</Button> : null}
    </footer>
  ) : null;

/**
 * While the splash is up, the page under it takes no focus and no pointer (`inert`): the splash
 * has it, and gives it back to what had it once it goes.
 */
const useModal = (area: RefObject<HTMLElement | null>) =>
  useEffect(() => {
    const root = area.current;
    if (!root) {
      return;
    }
    const before =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const covered: Element[] = [];
    for (
      let node: Element | null = root;
      node?.parentElement && node !== document.body;
      node = node.parentElement
    ) {
      for (const sibling of node.parentElement.children) {
        if (sibling !== node && !sibling.hasAttribute("inert")) {
          sibling.setAttribute("inert", "");
          covered.push(sibling);
        }
      }
    }
    root.focus();
    return () => {
      for (const element of covered) {
        element.removeAttribute("inert");
      }
      before?.focus();
    };
  }, [area]);

/** Escape calls `cancel`, while there is one. */
const useEscape = (cancel: (() => void) | undefined) =>
  useEffect(() => {
    if (!cancel) {
      return;
    }
    const press = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        cancel();
      }
    };
    window.addEventListener("keydown", press);
    return () => window.removeEventListener("keydown", press);
  }, [cancel]);

export interface OpeningSplashProps {
  /** The editor is ready: the splash wipes away (fades, under reduced motion). */
  readonly leaving?: boolean;
  /** Takes the splash away: back to the project open before, or the start screen. */
  readonly onCancel?: (() => void) | undefined;
  /** Runs a failed open again. */
  readonly onRetry?: (() => void) | undefined;
  readonly opening: Opening;
}

export const OpeningSplash = ({
  leaving = false,
  onCancel,
  onRetry,
  opening,
}: OpeningSplashProps) => {
  const area = useRef<HTMLDivElement>(null);
  const failed = opening.problem !== undefined;
  const done = opening.steps.every((s) => s.state === "done");
  const now = useNow(!(failed || done || leaving));
  const elapsed = Math.max(0, now - opening.since);
  const [showLog, setShowLog] = useState(false);
  const titleId = useId();
  useEscape(onCancel);
  useModal(area);

  const fraction = barAt(opening, elapsed, done);
  const settled = failed || done || elapsed >= SETTLE_MS;
  const working = currentStep(opening);

  return (
    <div
      aria-busy={!failed}
      aria-labelledby={titleId}
      aria-modal="true"
      className={cn(
        "fixed inset-0 z-50 cursor-cell overflow-auto bg-canvas text-foreground",
        leaving &&
          "pointer-events-none motion-safe:animate-splash-wipe motion-reduce:animate-splash-fade"
      )}
      ref={area}
      role="dialog"
      tabIndex={-1}
    >
      <PaintLayer over={area} />
      {/* The header where the static splash of `index.html` puts it: React's takes its place
          without a jump, whatever comes under it. */}
      <main className="relative mx-auto flex w-[440px] max-w-[calc(100vw-32px)] flex-col gap-6 pt-[max(32px,calc(50vh-140px))] pb-8">
        <header className="flex flex-col items-center gap-8">
          <Lockup className="h-7.5" />
          <div className="flex w-full flex-col items-center gap-1 text-center">
            <h1 className="text-balance font-heading-medium" id={titleId}>
              {failed
                ? `${opening.name} didn’t open`
                : `Opening ${opening.name}`}
            </h1>
            <p className="max-w-full truncate font-body-small text-muted-foreground">
              {opening.where}
            </p>
          </div>
        </header>
        <div
          className={cn(
            "flex flex-col gap-6 motion-safe:transition-opacity motion-safe:duration-150",
            settled ? "opacity-100" : "opacity-0"
          )}
        >
          {fraction === null || opening.estimate === undefined ? null : (
            <div className="flex flex-col gap-2">
              <BrushBar fraction={fraction} />
              <p className="font-body-small text-muted-foreground">
                {timeLeft(opening.estimate, elapsed, done)}
              </p>
            </div>
          )}
          <ol aria-label="Steps" className="flex flex-col">
            {opening.steps.map((step) => (
              <StepRow key={step.id} now={now} opening={opening} step={step} />
            ))}
          </ol>
          {showLog ? <LogBox lines={opening.log} /> : null}
          <Footer
            log={
              opening.remote
                ? { shown: showLog, toggle: () => setShowLog((s) => !s) }
                : null
            }
            onCancel={onCancel}
            onRetry={failed ? onRetry : undefined}
          />
        </div>
        {working?.state === "now" ? (
          <span className="sr-only" role="status">
            {working.label}
          </span>
        ) : null}
      </main>
    </div>
  );
};
