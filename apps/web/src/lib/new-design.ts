/**
 * A design the desktop app has just written from nothing (PLAN-desktop D11) opens on Sync's
 * define step, as the scratch case of ADR 0025 does once its application is started: the app
 * loads the editor with `?new-design=<template>`. Its code is a template there is nothing to read
 * in yet, so the setup's first step, reading what the code uses, is run and gone past at once;
 * the starter's components get their specs with the design's look (ADR 0029), as an application
 * started from Sync does.
 */
import {
  showSetup as showSync,
  useDesignSystemSetup,
} from "../state/design-system-setup.ts";
import { reportError } from "../state/project.ts";
import { useSync } from "../state/sync.ts";
import { adoptLooks } from "./scaffold.ts";

/** The parameter the desktop app opens a new design with. */
export const NEW_DESIGN_PARAM = "new-design";

/** The template the editor was opened with, taken off the URL: a reload is not a new design. */
const takeNewDesign = (): "blank" | "starter" | null => {
  const url = new URL(window.location.href);
  const template = url.searchParams.get(NEW_DESIGN_PARAM);
  if (template === null) {
    return null;
  }
  url.searchParams.delete(NEW_DESIGN_PARAM);
  window.history.replaceState(null, "", `${url.pathname}${url.search}`);
  return template === "starter" ? "starter" : "blank";
};

/** Once the project is configured: the Sync view, its define step next. */
export const openNewDesignOnSync = async () => {
  const template = takeNewDesign();
  if (template === null) {
    return;
  }
  showSync();
  try {
    if (template === "starter") {
      await adoptLooks();
    }
    const setup = useDesignSystemSetup.getState();
    await setup.load();
    const inventory = useDesignSystemSetup
      .getState()
      .setup?.steps.find((s) => s.id === "inventory");
    if (inventory?.status === "todo") {
      // Read there and then: it waits for the user to go on, which a template needs not.
      await setup.start("inventory");
      await setup.complete("inventory");
    }
    // The plan follows the setup: read again, it says define is next.
    await useSync.getState().load();
  } catch (error) {
    reportError(error);
  }
};
