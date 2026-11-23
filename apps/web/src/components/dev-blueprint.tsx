/**
 * Ultrapaint Dev's look (ADR 0113): blueprint paper under the whole tab strip from the window's
 * left edge, fading out towards the right, a line of its blue along the window's top edge, and in
 * the room past the + a drawing still being worked out. It moves the window as the strip does.
 * Drawn for the eye only; nothing in it moves.
 */
/**
 * The blueprint's paper: under the whole strip from the window's left edge, behind Home and the
 * tabs, fading out towards the right, with a line of its blue along the window's top edge.
 */
export const DevBlueprint = () => (
  <div
    aria-hidden="true"
    className="pointer-events-none absolute inset-0 -z-10 overflow-hidden bg-blueprint [mask-image:linear-gradient(90deg,black_30%,transparent)]"
    data-look="blueprint"
  >
    <svg className="absolute inset-0 size-full" role="presentation">
      <defs>
        <pattern
          height="8"
          id="blueprint-minor"
          patternUnits="userSpaceOnUse"
          width="8"
        >
          <path
            className="stroke-blueprint-ink"
            d="M8 0H0V8"
            fill="none"
            strokeWidth="0.5"
          />
        </pattern>
        <pattern
          height="40"
          id="blueprint-major"
          patternUnits="userSpaceOnUse"
          width="40"
        >
          <path
            className="stroke-blueprint-ink"
            d="M40 0H0V40"
            fill="none"
            strokeWidth="1"
          />
        </pattern>
      </defs>
      <rect fill="url(#blueprint-minor)" height="100%" width="100%" />
      <rect fill="url(#blueprint-major)" height="100%" width="100%" />
    </svg>
    <div className="absolute inset-x-0 top-0 h-px bg-blueprint-line" />
  </div>
);

/**
 * The blueprint's drawing: a construction line, a dimension and a registration mark, in the
 * room past the + and never behind a tab; many tabs take that room and it gives way.
 */
export const DevBlueprintDrawing = () => (
  <div
    aria-hidden="true"
    className="relative min-w-0 flex-1 self-stretch overflow-hidden"
    data-look="blueprint-drawing"
  >
    <svg
      className="absolute top-0 left-2 h-full w-[230px] fill-none stroke-blueprint-line opacity-50"
      role="presentation"
      viewBox="0 0 230 44"
    >
      <path d="M0 22C100 2 160 4 230 44" opacity="0.6" strokeDasharray="3 3" />
      <path d="M22 30H202M22 26V34M202 26V34" />
      <circle cx="52" cy="14" r="6" />
      <path d="M42 14H62M52 4V24" />
      <path
        className="fill-blueprint-line stroke-none"
        d="M32 30l6-3v6zM192 30l-6-3v6z"
      />
    </svg>
  </div>
);
