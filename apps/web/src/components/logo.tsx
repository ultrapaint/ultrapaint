/**
 * Ultrapaint's mark: an ultramarine tile with a U drawn as one stroke of paint, its right arm
 * running past the left as a brush lifts. The same in the splash, the title and the desktop app.
 */
import { cn } from "cn";

export const Logo = ({ className }: { className?: string }) => (
  <svg
    aria-label="Ultrapaint"
    className={cn("size-6 shrink-0", className)}
    role="img"
    viewBox="0 0 24 24"
  >
    <rect className="fill-brand" height="24" rx="6.5" width="24" />
    <path
      className="stroke-brand-foreground"
      d="M7.5 7v4.75a4.5 4.5 0 0 0 9 0V5.5"
      fill="none"
      strokeLinecap="round"
      strokeWidth="2.6"
    />
  </svg>
);
