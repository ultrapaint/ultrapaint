/**
 * What the look page does (ADR 0062): it opens on the samples, writes the look the dials make as
 * the project's design system, leaves the look to an agent, or hands an agent a description or a
 * site to make it from. A first prompt from the start screen that waited for the look is sent
 * once it is settled, in the chat it would have had.
 */
import type { FirstPrompt } from "@ultrapaint/contracts/shell-bridge";
import {
  dialsLine,
  type LookDials,
  lookSystem,
  presetOf,
} from "@ultrapaint/design-document/look-dials";
import { leaveBoard, openBoard, useBoard } from "../state/board.ts";
import { api } from "../state/connection.ts";
import { useDesignSystem } from "../state/design-system.ts";
import {
  hideLookPage,
  LOOK_ITEM,
  showLookPage,
  useLookPage,
} from "../state/look-page.ts";
import { reportError } from "../state/project.ts";
import { sendPrompt } from "./first-prompt.ts";
import { startNewLook } from "./start-thread.ts";

/** Opens the look page on its samples; `pending` is sent once the look is settled. */
export const openLookPage = (pending: FirstPrompt | null = null) => {
  showLookPage(pending);
  openBoard({ item: LOOK_ITEM, view: "system" });
};

/** Closes the page, back on the canvas, and sends what waited for the look. */
const settled = async (pending: FirstPrompt | null) => {
  hideLookPage();
  leaveBoard();
  if (pending) {
    await sendPrompt({ ...pending, look: "agent" });
  }
};

/** DESIGN.md's Overview for a look chosen on the page: its preset, and its dials in one line. */
export const overviewOf = (dials: LookDials) =>
  `## Overview\n\n${presetOf(dials)?.name ?? "A look of its own"}, chosen on the look page: ${dialsLine(dials)}.\n`;

/** Writes the look as the project's design system, then goes on to the first screen. */
export const saveTheLook = async () => {
  const { dials, pending } = useLookPage.getState();
  try {
    await api().request("designSystem.write", {
      designSystem: lookSystem(dials),
      document: overviewOf(dials),
    });
    await useDesignSystem.getState().load();
  } catch (error) {
    reportError(error);
    return;
  }
  await settled(pending);
};

/** The agent settles the look itself, from the prompt; with none waiting, in a chat drafted for it. */
export const letTheAgentDecide = async () => {
  const { pending } = useLookPage.getState();
  if (pending) {
    await settled(pending);
    return;
  }
  hideLookPage();
  leaveBoard();
  await startNewLook();
};

/** An agent makes the look from what the person said (a description, a site), then the screen. */
export const describeTheLook = async (description: string) => {
  const { pending } = useLookPage.getState();
  const look = `Make this project's look from this: ${description.trim()}\n\nWrite its design system before anything else, and say in three lines what you chose.`;
  hideLookPage();
  leaveBoard();
  await sendPrompt({
    look: "agent",
    ...(pending ?? {}),
    prompt: pending ? `${look}\n\nThen: ${pending.prompt}` : look,
  });
};

// Leaving the samples (another place, another item) leaves the trial look with them.
useBoard.subscribe((now) => {
  const onLook = now.open?.view === "system" && now.open.item === LOOK_ITEM;
  if (!onLook && useLookPage.getState().open) {
    hideLookPage();
  }
});
