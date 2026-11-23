/**
 * Ultrapaint Dev's look (ADR 0113): blueprint paper in the tab strip's empty space past the +,
 * a fine grid with a construction line, a dimension and a registration mark, as a drawing still
 * being worked out, and a line of its blue along the window's top edge. It fades in from the
 * left, takes only the room the tabs leave, and moves the window as the strip does. Drawn for the
 * eye only; nothing in it moves.
 */
export const DevBlueprint = () => (
  <div
    aria-hidden="true"
    className="relative -mr-2.5 min-w-0 flex-1 self-stretch overflow-hidden bg-blueprint [mask-image:linear-gradient(90deg,transparent,black_40%)]"
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
    {/* The drawing, at the window's right edge. */}
    <svg
      className="absolute top-0 right-0 h-full w-[230px] fill-none stroke-blueprint-line"
      role="presentation"
      viewBox="0 0 230 44"
    >
      <path d="M0 44C70 4 130 2 230 22" opacity="0.6" strokeDasharray="3 3" />
      <path d="M28 30H208M28 26V34M208 26V34" />
      <circle cx="178" cy="14" r="6" />
      <path d="M168 14H188M178 4V24" />
      <path
        className="fill-blueprint-line stroke-none"
        d="M38 30l6-3v6zM198 30l-6-3v6z"
      />
    </svg>
    <div className="absolute inset-x-0 top-0 h-px bg-blueprint-line" />
  </div>
);
