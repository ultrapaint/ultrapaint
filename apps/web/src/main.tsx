import { createRoot } from "react-dom/client";
import { App } from "./app.tsx";
import { frameErrors, frameOf } from "./canvas/editor-frame.ts";
import { openCanvas } from "./lib/canvas-actions.ts";
import { zoomToPage } from "./lib/page-actions.ts";
import { BillingPage } from "./pages/billing.tsx";
import { PricingPage } from "./pages/pricing.tsx";
import { useAgents } from "./state/agents.ts";
import { useAttachments } from "./state/attachments.ts";
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
    // What `pnpm e2e:sandbox` reads the frames' errors by.
    frameErrors,
    frameOf,
    goTo,
    // What `pnpm bench:canvas` drives the canvas with.
    openCanvas,
    setView,
    showLeftPanel,
    useAgents,
    useAttachments,
    useDocuments,
    useEditor,
    useProject,
    zoomToFit,
    zoomToPage,
  };
}

const pathname = window.location.pathname.replace(/\/$/, "");
const Page =
  {
    "/pricing": PricingPage,
    "/settings/billing": BillingPage,
  }[pathname] ?? App;

createRoot(document.getElementById("root") as HTMLElement).render(<Page />);
