import { useEffect } from "react";
import { Toaster } from "@/components/ui/sonner";
import { followProjectNotices } from "../lib/project-notices.ts";
import { useTheme } from "../state/theme.ts";

/**
 * The toasts of the desktop app's project notices on a page with no toaster of its own: the start
 * page Home shows (ADR 0107). The editor follows them beside its own toasts (`app.tsx`).
 */
export const ProjectNoticeToasts = () => {
  const theme = useTheme((s) => s.resolved);
  useEffect(() => followProjectNotices(), []);
  return <Toaster position="bottom-right" theme={theme} />;
};
