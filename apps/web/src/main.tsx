import { createRoot } from "react-dom/client";
import { App } from "./app.tsx";
import { frameErrors, frameOf } from "./canvas/editor-frame.ts";
import { openCanvas } from "./lib/canvas-actions.ts";
import { pageById, zoomToPage } from "./lib/page-actions.ts";
import { BillingPage } from "./pages/billing.tsx";
import { PricingPage } from "./pages/pricing.tsx";
import { useAgents } from "./state/agents.ts";
import { useAttachments } from "./state/attachments.ts";
import { leaveBoard, openBoard, useBoard } from "./state/board.ts";
import { setView, zoomToFit } from "./state/camera.ts";
import { api } from "./state/connection.ts";
import { useDocuments } from "./state/documents.ts";
import { useEditor } from "./state/editor.ts";
import { goTo } from "./state/location.ts";
import { showLeftPanel } from "./state/panels.ts";
import { useProject } from "./state/project.ts";
import "./styles.css";

if (import.meta.env.DEV) {
  (window as unknown as { __ed: unknown }).__ed = {
    api,
    frameErrors,
    frameOf,
    goTo,
    leaveBoard,
    openBoard,
    // What `pnpm bench:canvas` drives the canvas with.
    openCanvas,
    setView,
    showLeftPanel,
    useAgents,
    useAttachments,
    useBoard,
    useDocuments,
    useEditor,
    useProject,
    zoomToFit,
    // A page by its id, as a script has it.
    zoomToPage: (id: string) => {
      const page = pageById(id);
      if (!page) {
        throw new Error(`zoomToPage: no page ${id}`);
      }
      return zoomToPage(page);
    },
  };
}

const pathname = window.location.pathname.replace(/\/$/, "");
const Page =
  {
    "/pricing": PricingPage,
    "/settings/billing": BillingPage,
  }[pathname] ?? App;

createRoot(document.getElementById("root") as HTMLElement).render(<Page />);
