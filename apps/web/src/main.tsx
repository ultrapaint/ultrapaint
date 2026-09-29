import { createRoot } from "react-dom/client";
import { App } from "./app.tsx";
import { bridgeFor } from "./canvas/bridge.ts";
import { BillingPage } from "./pages/billing.tsx";
import { PricingPage } from "./pages/pricing.tsx";
import { useAgents } from "./state/agents.ts";
import { useAttachments } from "./state/attachments.ts";
import { api } from "./state/connection.ts";
import { useDocuments } from "./state/documents.ts";
import { useEditor } from "./state/editor.ts";
import { useProject } from "./state/project.ts";
import "./styles.css";

if (import.meta.env.DEV) {
  (window as unknown as { __ed: unknown }).__ed = {
    api,
    bridgeFor,
    useAgents,
    useAttachments,
    useDocuments,
    useEditor,
    useProject,
  };
}

const pathname = window.location.pathname.replace(/\/$/, "");
const Page =
  {
    "/pricing": PricingPage,
    "/settings/billing": BillingPage,
  }[pathname] ?? App;

createRoot(document.getElementById("root") as HTMLElement).render(<Page />);
