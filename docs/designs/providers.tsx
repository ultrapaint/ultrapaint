import type { ReactNode } from "react";

/** The editor is dark: its own designs are drawn in its dark theme. */
export default function Providers({ children }: { children: ReactNode }) {
  return (
    <div className="dark flex min-h-full flex-col bg-background font-sans text-foreground text-xs/relaxed antialiased">
      {children}
    </div>
  );
}
