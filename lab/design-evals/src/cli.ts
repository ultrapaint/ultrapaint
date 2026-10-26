/**
 * The design evals: how well the design skills ultrapaint ships teach agents to design, found
 * by asking for screens someone already made well and comparing. Internal: nothing here ships.
 *
 *   node lab/design-evals/src/cli.ts capture [refs…]     pictures and text of the references
 *   node lab/design-evals/src/cli.ts brief [refs…]       their content as a brief, to read and fix
 *   node lab/design-evals/src/cli.ts round <name> [refs…] generate, judge and report, in one go
 *   node lab/design-evals/src/cli.ts compare <baseline> <candidate>   two rounds' scores
 *
 * `generate`, `judge` and `report` run one step of a round each, to resume or redo one.
 * See lab/design-evals/README.md.
 */
import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Effect, Layer, Option } from "effect";
import { Argument, Command, Flag } from "effect/cli";
import { writeBrief } from "./brief.ts";
import { Browser } from "./browser.ts";
import { captureReference } from "./capture.ts";
import { Claude } from "./claude.ts";
import { compare } from "./compare.ts";
import { generate } from "./generate.ts";
import { judge } from "./judge.ts";
import { loadReferences } from "./reference.ts";
import { report } from "./report.ts";

const refs = Argument.String("refs").pipe(
  Argument.withDescription(
    "Reference ids (directories of references/); all when none"
  ),
  Argument.variadic()
);
// Positional arguments are read in the order of their keys, which the formatter sorts: `name`
// comes before `refs`, as on the command line.
const name = Argument.String("round").pipe(
  Argument.withDescription("Name of the round: its directory under runs/")
);
const force = Flag.Boolean("force").pipe(
  Flag.withDescription("Do it again where it was done before"),
  Flag.withDefault(false)
);
const model = (fallback: string, what: string) =>
  Flag.String("model").pipe(
    Flag.withDescription(`Claude model ${what} (an alias or a full name)`),
    Flag.withDefault(fallback)
  );
const generateFlags = {
  agent: Flag.String("agent").pipe(
    Flag.withDescription(
      "The ultrapaint agent that designs: claude-code, codex…"
    ),
    Flag.withDefault("claude-code")
  ),
  agentModel: Flag.String("agent-model").pipe(
    Flag.withDescription(
      'Pin the agent\'s model by the name its picker shows ("Opus 5.5"); its default otherwise'
    ),
    Flag.optional
  ),
  minutes: Flag.Int("minutes").pipe(
    Flag.withDescription("How long one run may take, in minutes"),
    Flag.withDefault(30)
  ),
  runs: Flag.Int("runs").pipe(
    Flag.withDescription(
      "Runs per reference: what varies between them is what is flaky"
    ),
    Flag.withDefault(3)
  ),
  skills: Flag.String("skills").pipe(
    Flag.withDescription(
      "A directory of skill files to try instead of the shipped ones: candidates/<name>"
    ),
    Flag.optional
  ),
};
const judgeFlags = {
  concurrency: Flag.Int("concurrency").pipe(
    Flag.withDescription("Runs judged at once"),
    Flag.withDefault(3)
  ),
  judgeModel: Flag.String("judge-model").pipe(
    Flag.withDescription("Claude model that judges and reports"),
    Flag.withDefault("opus")
  ),
};

const captureCommand = Command.make(
  "capture",
  { force, refs },
  Effect.fn(function* (input) {
    for (const reference of yield* loadReferences(input.refs)) {
      yield* captureReference(reference, input.force);
    }
  })
).pipe(
  Command.withDescription(
    "Take each reference's pictures at every viewport, and its text"
  ),
  Command.provide(Browser.layer)
);

const briefCommand = Command.make(
  "brief",
  { force, model: model("opus", "that writes the brief"), refs },
  Effect.fn(function* (input) {
    for (const reference of yield* loadReferences(input.refs)) {
      yield* writeBrief(reference, { force: input.force, model: input.model });
    }
  })
).pipe(
  Command.withDescription(
    "Write each reference's content as a brief, without its design"
  )
);

interface GenerateInput {
  readonly agent: string;
  readonly agentModel: Option.Option<string>;
  readonly minutes: number;
  readonly name: string;
  readonly refs: readonly string[];
  readonly runs: number;
  readonly skills: Option.Option<string>;
}

const runGenerate = Effect.fn("runGenerate")(function* (input: GenerateInput) {
  yield* generate(yield* loadReferences(input.refs), {
    agent: input.agent,
    minutes: input.minutes,
    model: Option.getOrUndefined(input.agentModel),
    round: input.name,
    runs: input.runs,
    skills: Option.getOrUndefined(input.skills),
  });
});

const generateCommand = Command.make(
  "generate",
  { name, refs, ...generateFlags },
  runGenerate
).pipe(
  Command.withDescription(
    "Have an agent design each reference from its brief, in ultrapaint"
  ),
  Command.provide(Browser.layer)
);

const judgeCommand = Command.make(
  "judge",
  { force, name, ...judgeFlags },
  Effect.fn(function* (input) {
    yield* judge(input.name, {
      concurrency: input.concurrency,
      force: input.force,
      model: input.judgeModel,
    });
  })
).pipe(
  Command.withDescription("Judge every run of a round beside its reference")
);

const reportCommand = Command.make(
  "report",
  { judgeModel: judgeFlags.judgeModel, name },
  Effect.fn(function* (input) {
    yield* report(input.name, { model: input.judgeModel });
  })
).pipe(
  Command.withDescription(
    "Put a round's judgements together: scores, gaps, proposals"
  )
);

const roundCommand = Command.make(
  "round",
  { name, refs, ...generateFlags, ...judgeFlags },
  Effect.fn(function* (input) {
    yield* runGenerate(input);
    yield* judge(input.name, {
      concurrency: input.concurrency,
      force: false,
      model: input.judgeModel,
    });
    yield* report(input.name, { model: input.judgeModel });
  })
).pipe(
  Command.withDescription(
    "Generate, judge and report: one round, resumed where it stopped"
  ),
  Command.provide(Browser.layer)
);

const compareCommand = Command.make(
  "compare",
  {
    baseline: Argument.String("baseline").pipe(
      Argument.withDescription("The round to compare against")
    ),
    candidate: Argument.String("candidate").pipe(
      Argument.withDescription("The round that tried something")
    ),
  },
  Effect.fn(function* (input) {
    yield* compare(input.baseline, input.candidate);
  })
).pipe(Command.withDescription("Two rounds' scores side by side"));

Command.make("design-evals").pipe(
  Command.withDescription(
    "Find what the shipped design skills fail to teach, by remaking good screens and comparing"
  ),
  Command.withSubcommands([
    captureCommand,
    briefCommand,
    roundCommand,
    generateCommand,
    judgeCommand,
    reportCommand,
    compareCommand,
  ]),
  Command.run({ version: "0.0.0" }),
  Effect.provide(Claude.layer.pipe(Layer.provideMerge(NodeServices.layer))),
  NodeRuntime.runMain
);
