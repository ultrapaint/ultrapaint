/**
 * The repository's components, loaded into the editor's own page (ADR 0034): the module the
 * preview's server generates, imported once from the editor's origin, which forwards
 * `/preview/` to it. Every frame of the canvas draws with what it returns.
 */
import type { Preview } from "@ultrapaint/framework-api/browser";
import { useEffect, useSyncExternalStore } from "react";
import { useProject } from "../state/project.ts";
import { readFrozen, watchPreview } from "./watchdog.ts";

interface PreviewModule {
  readonly onReloadRequest: (listener: () => void) => () => void;
  readonly preview: Preview;
}

let loading: { entry: string; module: Promise<PreviewModule> } | null = null;
let loaded: { entry: string; preview: Preview } | null = null;
const listeners = new Set<() => void>();

/**
 * Imports the preview's entry, once per entry. The dev server asks for the page to be loaded
 * again when the modules it holds are out of date (its dependencies bundled anew, the server
 * started again): the editor's page is then loaded again, which is the only way to drop them.
 */
const load = (entry: string) => {
  if (loading?.entry === entry) {
    return loading.module;
  }
  // The frames that froze the editor before are known before anything is drawn.
  const module = Promise.all([
    import(/* @vite-ignore */ entry) as Promise<PreviewModule>,
    readFrozen(useProject.getState().info.repoPath ?? ""),
  ]).then(([m]) => m);
  loading = { entry, module };
  module.then(
    (m) => {
      m.onReloadRequest(() => window.location.reload());
      watchPreview(m.preview);
      loaded = { entry, preview: m.preview };
      for (const listener of listeners) {
        listener();
      }
    },
    () => {
      // Tried again on the next start of the preview's server.
      if (loading?.entry === entry) {
        loading = null;
      }
    }
  );
  return module;
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
const snapshot = () => loaded;

/** The preview while the project's runs and its module has loaded; null until then. */
export const usePreview = (): Preview | null => {
  const entry = useProject((s) =>
    s.info.host.state === "running" ? (s.info.host.entry ?? null) : null
  );
  useEffect(() => {
    if (entry !== null) {
      load(entry).catch(() => undefined);
    }
  }, [entry]);
  const current = useSyncExternalStore(subscribe, snapshot);
  return entry !== null && current?.entry === entry ? current.preview : null;
};

/**
 * The preview, once its module has loaded; null when the project's preview is not running or
 * its module could not be loaded. For what draws outside React: pictures, screenshots.
 */
export const previewReady = async (): Promise<Preview | null> => {
  const { host } = useProject.getState().info;
  if (host.state !== "running" || !host.entry) {
    return null;
  }
  try {
    return (await load(host.entry)).preview;
  } catch {
    // Not loaded: no picture is drawn, and the next one tries again.
    return null;
  }
};
