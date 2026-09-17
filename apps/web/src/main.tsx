import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { bridgeFor } from "./canvas/bridge.ts";
import { api } from "./state/connection.ts";
import { useEditor } from "./state/editor.ts";
import { useProject } from "./state/project.ts";
import "./styles.css";

if (import.meta.env.DEV) {
  (window as unknown as { __ed: unknown }).__ed = { api, useEditor, useProject, bridgeFor };
}

createRoot(document.getElementById("root") as HTMLElement).render(<App />);
