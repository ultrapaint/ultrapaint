/**
 * What a panel shows while its code is on its way. The splash a project opens on is
 * `opening-splash.tsx` (ADR 0099).
 */
import { Spinner } from "@/components/ui/spinner";

/** What a panel shows in the moment its code is still on its way: never a blank panel. */
export const PanelLoading = () => (
  <div className="flex h-full items-center justify-center text-muted-foreground">
    <Spinner className="size-3.5" />
  </div>
);
