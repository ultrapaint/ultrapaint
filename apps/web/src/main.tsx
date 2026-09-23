import { createRoot } from "react-dom/client";
import { App } from "./app.tsx";
import { bridgeFor } from "./canvas/bridge.ts";
import { BillingPage } from "./pages/billing.tsx";
import { api } from "./state/connection.ts";
import { useEditor } from "./state/editor.ts";
import { useProject } from "./state/project.ts";
import "./styles.css";

if (import.meta.env.DEV) {
  (window as unknown as { __ed: unknown }).__ed = {
    api,
    bridgeFor,
    useEditor,
    useProject,
  };
}

const isBillingPage = /^\/settings\/billing\/?$/.test(window.location.pathname);

createRoot(document.getElementById("root") as HTMLElement).render(
  isBillingPage ? <BillingPage /> : <App />
);
