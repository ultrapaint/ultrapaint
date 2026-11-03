/**
 * Where the design evals keep things, and what the environment tells them. The code and its
 * prompts are here, in Ultrapaint's repository (`evals/`); what they read and write is in the data
 * directory, kept out of git. Ultrapaint itself is run as its command and reached through its wire
 * contracts, never imported otherwise.
 */
import os from "node:os";
import path from "node:path";
import { Context, Layer } from "effect";

/** The evals' own directory in the repository: the code and the prompts. */
export const EVALS = path.resolve(import.meta.dirname, "..");

/** The data directory, and where each thing is in it. */
export interface DataDir {
  readonly briefFile: (reference: string) => string;
  /** Skill files to try in a round instead of, or on top of, the shipped ones. */
  readonly candidates: string;
  readonly captureDir: (reference: string) => string;
  /** The library of well-made sites the studies look at, one directory per source. */
  readonly corpus: string;
  /** A product's screens and component crops, for track A. */
  readonly families: string;
  readonly familyDir: (family: string) => string;
  /** A path as the reports show it: from the data directory. */
  readonly fromData: (file: string) => string;
  /** The shots a person chooses references from. */
  readonly gallery: string;
  readonly hostDir: (host: string) => string;
  /** The projects the agents design in, one directory each, made with `ultrapaint new`. */
  readonly hosts: string;
  readonly referenceDir: (reference: string) => string;
  /** One directory per reference: `reference.json`, its capture and its brief. */
  readonly references: string;
  readonly root: string;
  readonly runDir: (round: string, reference: string, run: number) => string;
  /** One directory per round: what was generated, how it was judged, the report. */
  readonly runs: string;
  /** What the studies wrote, one directory per model. */
  readonly studies: string;
  /** Scratch: the servers' configurations, designs directories and logs. */
  readonly work: string;
}

export const dataDirAt = (root: string): DataDir => {
  const references = path.join(root, "references");
  const runs = path.join(root, "runs");
  const hosts = path.join(root, "hosts");
  const families = path.join(root, "families");
  return {
    briefFile: (reference) => path.join(references, reference, "brief.md"),
    candidates: path.join(root, "candidates"),
    captureDir: (reference) => path.join(references, reference, "capture"),
    corpus: path.join(root, "corpus"),
    families,
    familyDir: (family) => path.join(families, family),
    fromData: (file) => path.relative(root, file),
    gallery: path.join(root, "gallery"),
    hostDir: (host) => path.join(hosts, host),
    hosts,
    referenceDir: (reference) => path.join(references, reference),
    references,
    root,
    runDir: (round, reference, run) =>
      path.join(runs, round, reference, `run-${run}`),
    runs,
    studies: path.join(root, "studies"),
    work: path.join(root, ".work"),
  };
};

/** The variables the evals read, by name: what a person sets to point them elsewhere. */
type Environment = Readonly<Record<string, string | undefined>>;

/** Resolved once in `cli.ts` from the environment; nothing deeper reads `process.env`. */
export class EvalsConfig extends Context.Service<
  EvalsConfig,
  {
    /**
     * The Ultrapaint checkout whose command, skills and tools a round measures: the one the evals
     * are in, or `ULTRAPAINT_CHECKOUT` to measure another commit (a worktree of it).
     */
    readonly checkout: string;
    /**
     * The references, the hosts, the rounds and the studies: everything the evals read and write.
     * `ULTRAPAINT_EVALS_DATA`, else `~/Code/ultrapaint-data`.
     */
    readonly data: DataDir;
    /** The Chrome or Chromium to run (`LAB_BROWSER`); the first one installed without it. */
    readonly browser: string | undefined;
    /** Whether the editor's console errors are printed (`LAB_EDITOR_LOG`): why a picture failed. */
    readonly editorLog: boolean;
    /**
     * How the skills are told (`full`, `summaries`, `router`) when a round tries another way than
     * the server's default (`EVAL_SKILLS_BRIEFING`).
     */
    readonly skillsBriefing: string | undefined;
  }
>()("ultrapaint/evals/EvalsConfig") {
  static readonly fromEnvironment = (env: Environment) =>
    EvalsConfig.of({
      browser: env.LAB_BROWSER,
      checkout: path.resolve(env.ULTRAPAINT_CHECKOUT ?? path.join(EVALS, "..")),
      data: dataDirAt(
        path.resolve(
          env.ULTRAPAINT_EVALS_DATA ??
            path.join(os.homedir(), "Code", "ultrapaint-data")
        )
      ),
      editorLog: Boolean(env.LAB_EDITOR_LOG),
      skillsBriefing: env.EVAL_SKILLS_BRIEFING,
    });

  static readonly layerFrom = (env: Environment) =>
    Layer.succeed(EvalsConfig, EvalsConfig.fromEnvironment(env));
}
