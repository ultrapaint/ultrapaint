/**
 * Over the editor while it starts: until the project is read, the designs of the canvas it opens
 * on are in, and every panel's code is fetched (`app.tsx`). Then the editor is shown whole, and
 * nothing in it waits for its code. Its mark is the title's.
 */
import { Spinner } from "@/components/ui/spinner";
import { Logo } from "./logo.tsx";

export const Splash = ({ name }: { readonly name: string | null }) => (
  <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-background">
    <Logo className="size-10" />
    <span className="flex items-center gap-2 font-body text-muted-foreground">
      <Spinner />
      {name ? `Opening ${name}` : "Opening"}
    </span>
  </div>
);

/** What a panel shows in the moment its code is still on its way: never a blank panel. */
export const PanelLoading = () => (
  <div className="flex h-full items-center justify-center text-muted-foreground">
    <Spinner />
  </div>
);
