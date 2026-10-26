/**
 * A new design from nothing (PLAN-desktop D11): a folder, written with a configuration, a designs
 * directory and an application, its packages installed and, when the git integration is on, a
 * first commit. `ultrapaint new` writes it, and says how far it got one line at a time, which
 * the desktop app shows as the steps of its dialog.
 */
import { Schema } from "effect";
import { ScaffoldTemplate } from "./setup.ts";

/** Where the application's code goes: an `app` directory beside the designs, or the root. */
export const CodeLocation = Schema.Literals(["app", "root"]);
export type CodeLocation = typeof CodeLocation.Type;

/** Where a new design's pages go, beside its code. */
export const NEW_DESIGNS_DIR = "designs";

/** The directory the code goes in, relative to the folder. */
export const codeDirOf = (code: CodeLocation) => (code === "app" ? "app" : ".");

export const NewDesignOptions = Schema.Struct({
  code: CodeLocation,
  /** Absolute; made when it is not there. Empty, or a new design written before (to finish it). */
  folder: Schema.String,
  /** A first commit, `Start <name>`, and the git setting on. */
  git: Schema.Boolean,
  /** Install the packages once the files are written. */
  install: Schema.Boolean,
  name: Schema.String,
  /** The package manager to install with, in place of the one found: pnpm when there, npm else. */
  packageManager: Schema.optional(Schema.String),
  template: ScaffoldTemplate,
});
export type NewDesignOptions = typeof NewDesignOptions.Type;

/** The steps, in order. Git only when the integration is on. */
export const NewDesignStep = Schema.Literals([
  "folder",
  "write",
  "install",
  "git",
]);
export type NewDesignStep = typeof NewDesignStep.Type;

export const NewDesignStepState = Schema.Literals([
  "active",
  "done",
  /** Not needed: not asked for, or done by an earlier run. */
  "skipped",
  "failed",
]);
export type NewDesignStepState = typeof NewDesignStepState.Type;

/** One line of `ultrapaint new --progress-json`. */
export const NewDesignProgress = Schema.Struct({
  /** What it did, or why it failed, in a sentence or a few lines. */
  detail: Schema.optional(Schema.String),
  state: NewDesignStepState,
  step: NewDesignStep,
});
export type NewDesignProgress = typeof NewDesignProgress.Type;

export const NewDesignProgressLine = Schema.fromJsonString(NewDesignProgress);
