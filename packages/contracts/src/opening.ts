/**
 * A project opening (ADR 0099): the steps from the click to its editor ready, each with its time,
 * the estimate from the project's last open, what the step at work last printed and, when one
 * fails, why. The desktop app holds it for the window (the shell bridge's `opening`), and the
 * editor finishes it with its own steps; the editor opened in a browser keeps one of its own.
 * The splash draws it.
 */
import { Schema } from "effect";

/**
 * A step of an open, by what it does:
 *
 * - `server`: a local project's server starts and says where it listens;
 * - `connect`: the app connects to a project's machine over SSH;
 * - `remote`: the server starts on that machine;
 * - `editor`: the editor's code arrives and it reaches its server;
 * - `project`: the server has the project open and the editor has read it;
 * - `canvas`: the canvas the editor opens on is drawn.
 */
export const OpeningStepId = Schema.Literals([
  "server",
  "connect",
  "remote",
  "editor",
  "project",
  "canvas",
]);
export type OpeningStepId = typeof OpeningStepId.Type;

/**
 * How long each step of an opening took, by its id: what an estimate is made of. Finite: kept in
 * the desktop app's list, a non-finite one would be written as `null` and unreadable.
 */
export const OpeningTimes = Schema.Struct({
  canvas: Schema.optional(Schema.Finite),
  connect: Schema.optional(Schema.Finite),
  editor: Schema.optional(Schema.Finite),
  project: Schema.optional(Schema.Finite),
  remote: Schema.optional(Schema.Finite),
  server: Schema.optional(Schema.Finite),
});
export type OpeningTimes = typeof OpeningTimes.Type;

/** The editor's own steps: it reaches them once its page loads, after the shell's. */
export const EDITOR_STEPS = ["editor", "project", "canvas"] as const;
export type EditorStepId = (typeof EDITOR_STEPS)[number];

/** Whether a step is one the editor reaches itself. */
export const isEditorStep = (id: OpeningStepId): id is EditorStepId =>
  (EDITOR_STEPS as readonly OpeningStepId[]).includes(id);

/**
 * Where an opening runs: a local project in the desktop app, one over SSH there, or the editor
 * opened in a browser from a repository, whose server is up already since it served the page.
 */
export type OpeningKind = "local" | "ssh" | "browser";

export const OpeningStep = Schema.Struct({
  id: OpeningStepId,
  /** What it does, as the splash says it: "Starting the server". */
  label: Schema.String,
  /** The last line the step printed while at work: a server's log, ssh's. */
  line: Schema.optional(Schema.String),
  /** How long it took, once done or failed. */
  ms: Schema.optional(Schema.Number),
  /** When it began, in milliseconds since the epoch: the splash counts its time from there. */
  since: Schema.optional(Schema.Number),
  state: Schema.Literals(["next", "now", "done", "failed"]),
});
export type OpeningStep = typeof OpeningStep.Type;

/** Why an open failed: what happened, and what to do about it. */
export const OpeningProblem = Schema.Struct({
  /** What to do, when it is known: "Load your key into the agent with ssh-add, then try again." */
  hint: Schema.optional(Schema.String),
  /** What happened, in a sentence: "naf-mini did not accept a key." */
  reason: Schema.String,
});
export type OpeningProblem = typeof OpeningProblem.Type;

export const Opening = Schema.Struct({
  /**
   * The project a Cancel goes back to: the one left open during a switch. Absent at the app's
   * start, or from the start screen with nothing open behind it.
   */
  back: Schema.optional(Schema.String),
  /**
   * How long the whole open took last time, in milliseconds: the bar's length. Absent on a
   * project's first open, which shows its steps without a bar.
   */
  estimate: Schema.optional(Schema.Number),
  /** What the open printed so far (ssh, the server), for Show log; the last lines only. */
  log: Schema.Array(Schema.String),
  name: Schema.String,
  /** Set once a step failed: the open stops there, and Try again runs it again. */
  problem: Schema.optional(OpeningProblem),
  /** Whether the project is on another machine: the splash offers its log. */
  remote: Schema.Boolean,
  /** When the open began, in milliseconds since the epoch. */
  since: Schema.Number,
  steps: Schema.Array(OpeningStep),
  /** Where the project is: its folder, or its host and folder. */
  where: Schema.String,
});
export type Opening = typeof Opening.Type;

/** What each step is called on the splash. */
const STEP_LABELS: Record<OpeningStepId, (host: string) => string> = {
  canvas: () => "Drawing the canvas",
  connect: (host) => `Connecting to ${host}`,
  editor: () => "Loading the editor",
  project: () => "Reading the project",
  remote: () => "Starting ultrapaint there",
  server: () => "Starting the server",
};

/** How much of the log an open keeps: enough to see why, little enough to send at each line. */
export const OPENING_LOG_LINES = 200;

/** The steps of an opening of `kind`, in order, all to come. */
const STEPS_OF: Record<OpeningKind, readonly OpeningStepId[]> = {
  browser: EDITOR_STEPS,
  local: ["server", "project", "canvas"],
  ssh: ["connect", "remote", "editor", "project"],
};

export const openingSteps = (
  kind: OpeningKind,
  /** The machine an SSH project is on, which its first step names. */
  host?: string
): OpeningStep[] =>
  STEPS_OF[kind].map((id) => ({
    id,
    label: STEP_LABELS[id](host ?? ""),
    state: "next",
  }));

/** The step at work now, or the one that failed; none once all are done. */
export const currentStep = (opening: Opening): OpeningStep | undefined =>
  opening.steps.find((s) => s.state === "now" || s.state === "failed");

/** Begins `id`: the steps before it are done, timed from when each began. */
export const reachStep = (
  opening: Opening,
  id: OpeningStepId | null,
  now: number
): Opening => {
  const at =
    id === null
      ? opening.steps.length
      : opening.steps.findIndex((s) => s.id === id);
  if (at === -1) {
    return opening;
  }
  return {
    ...opening,
    steps: opening.steps.map((step, i) => {
      if (i < at) {
        if (step.state === "done") {
          return step;
        }
        const began = step.since ?? now;
        const { line: _line, since: _since, ...rest } = step;
        return { ...rest, ms: Math.max(0, now - began), state: "done" };
      }
      if (i === at && step.state !== "now") {
        return { ...step, since: now, state: "now" };
      }
      return step;
    }),
  };
};

/** Notes a line the open printed: the log's last, and the step at work's. */
export const noteLine = (opening: Opening, line: string): Opening => {
  const text = line.trimEnd();
  if (text === "") {
    return opening;
  }
  return {
    ...opening,
    log: [...opening.log, text].slice(-OPENING_LOG_LINES),
    steps: opening.steps.map((s) =>
      s.state === "now" ? { ...s, line: text } : s
    ),
  };
};

/** The open failed at the step at work (or the first to come): the reason and what to do. */
export const failOpening = (
  opening: Opening,
  message: string,
  now: number
): Opening => {
  const at = Math.max(
    0,
    opening.steps.findIndex((s) => s.state !== "done")
  );
  return {
    ...opening,
    problem: problemOf(message),
    steps: opening.steps.map((step, i) => {
      if (i !== at) {
        return step;
      }
      const { line: _line, since: _since, ...rest } = step;
      return {
        ...rest,
        ms: Math.max(0, now - (step.since ?? now)),
        state: "failed",
      };
    }),
  };
};

/**
 * An error's message as the splash says it: its first sentence the reason, the rest what to do.
 * The lines a message quotes after a colon (a program's own output) are left to the log.
 */
const QUOTED_RE = /:\n/;
const SENTENCE_END_RE = /\.\s/;
const FINAL_STOP_RE = /\.$/;
const OPENS_SENTENCE_RE = /^(the|a|an) /;

export const problemOf = (message: string): OpeningProblem => {
  const said = message.split(QUOTED_RE)[0]?.trim() ?? "";
  const end = said.search(SENTENCE_END_RE);
  if (end === -1) {
    return { reason: `${capitalise(said.replace(FINAL_STOP_RE, ""))}.` };
  }
  const hint = said.slice(end + 1).trim();
  return {
    reason: capitalise(said.slice(0, end + 1)),
    ...(hint ? { hint: hint.endsWith(".") ? hint : `${hint}.` } : {}),
  };
};

/** "the server could not…" opens a sentence; a host's name ("naf-mini could not…") keeps its case. */
const capitalise = (text: string) =>
  OPENS_SENTENCE_RE.test(text)
    ? text.charAt(0).toUpperCase() + text.slice(1)
    : text;

/** The time each step took, by its id, for the estimate of the next open. */
export const stepTimes = (opening: Opening): OpeningTimes =>
  Object.fromEntries(
    opening.steps.flatMap((s) =>
      s.state === "done" && s.ms !== undefined ? [[s.id, s.ms]] : []
    )
  );

/**
 * The estimate from the times a project's last open took: their sum, when every step of this
 * open has one; none otherwise (a first open, or the steps changed).
 */
export const estimateFrom = (
  steps: readonly OpeningStep[],
  last: OpeningTimes | undefined
): number | undefined => {
  if (!last) {
    return undefined;
  }
  let total = 0;
  for (const step of steps) {
    const ms = last[step.id];
    if (ms === undefined) {
      return undefined;
    }
    total += ms;
  }
  return total;
};
