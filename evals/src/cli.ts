/**
 * The design evals: how well the design skills Ultrapaint ships teach agents to design, found
 * by asking for screens someone already made well and comparing. Internal: nothing here ships.
 *
 *   pnpm evals capture [refs…]                     pictures and text of the references
 *   pnpm evals brief [refs…]                       their content as a brief, to read and fix
 *   pnpm evals setup-host <host>                   import a host's design system with /init
 *   pnpm evals round <name> [refs…] --host <host>  generate, judge and report, in one go
 *   pnpm evals gallery                             choose the shots to take references from
 *   pnpm evals patterns annotate | book            Untitled UI's patterns, counted
 *   pnpm evals extract <round> [families…]         track A: a design system made from pictures
 *   pnpm evals freeze <family> <round> <run>       make a run's design system the family's library
 *   pnpm evals sections <round> [rounds…]          cut screens into sections, for the review
 *   pnpm evals learn <round>                       what your picks say, as rules for the skills
 *   pnpm evals review <round> [rounds…]            judge what rounds made yourself, by swiping
 *   pnpm evals compare <baseline> <candidate>      two rounds' scores
 *   pnpm evals gaps                                the design gaps, with kind and status
 *   pnpm evals decide <deck>                       answer the decisions an agent asks of you
 *   pnpm evals measure <url>                       measure a rendered page's group gaps and dividers
 *   pnpm evals recall <round> [sections…]          whether a reviewer finds what a person found
 *   pnpm evals panel <round> [rounds…]             what a fixed panel still finds in finished designs
 *
 * `generate`, `judge` and `report` run one step of a round each, to resume or redo one.
 * See evals/README.md.
 */
import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Effect, Layer, Option } from "effect";
import { Argument, Command, Flag } from "effect/cli";
import { writeBrief } from "./brief.ts";
import { Browser } from "./browser.ts";
import { captureReference } from "./capture.ts";
import { compare } from "./compare.ts";
import { judgeComponents } from "./component-judge.ts";
import { EvalsConfig } from "./config.ts";
import { decide } from "./decide.ts";
import { extract, freeze } from "./extract.ts";
import { GALLERY_SETS, gallery } from "./gallery.ts";
import { listGaps } from "./gap.ts";
import { generate } from "./generate.ts";
import { setupHost } from "./host.ts";
import { judge } from "./judge.ts";
import { learn } from "./learn.ts";
import { measure } from "./measure.ts";
import { Models } from "./models.ts";
import { pairwise } from "./pairwise.ts";
import { panel } from "./panel.ts";
import { annotate, book, CORPUS_NAMES } from "./patterns.ts";
import { recall } from "./recall.ts";
import { loadReferences } from "./reference.ts";
import { report } from "./report.ts";
import { review } from "./review.ts";
import { goalFrom, REVIEW_MODES, type ReviewMode } from "./review-loop.ts";
import { sections } from "./sections.ts";
import { DIMENSIONS, studyAnnotate, studyBook } from "./study.ts";

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
      "The Ultrapaint agent that designs: claude-code, codex…"
    ),
    Flag.withDefault("claude-code")
  ),
  agentModel: Flag.String("agent-model").pipe(
    Flag.withDescription(
      'Pin the agent\'s model by the name its picker shows ("Opus 5.5"); its default otherwise'
    ),
    Flag.optional
  ),
  host: Flag.String("host").pipe(
    Flag.withDescription(
      "The project under hosts/ the agents design in (blank, starter…), or `family`: each reference in its family's library"
    )
  ),
  minutes: Flag.Int("minutes").pipe(
    Flag.withDescription("How long one run may take, in minutes"),
    Flag.withDefault(30)
  ),
  picture: Flag.Boolean("picture").pipe(
    Flag.withDescription(
      "Give the agent the reference's picture with its brief, as a user attaches a screenshot"
    ),
    Flag.withDefault(false)
  ),
  prompt: Flag.String("prompt").pipe(
    Flag.withDescription(
      "The prompt under prompts/ the agent is given, in place of the brief's or the picture's"
    ),
    Flag.optional
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

/** The review loop of a round (ADR 0060): none unless `--review` says when. */
const reviewFlags = {
  budget: Flag.Int("budget").pipe(
    Flag.withDescription(
      "Dollars of review (where the models say what they cost) past which a loop stops"
    ),
    Flag.optional
  ),
  effort: Flag.String("effort").pipe(
    Flag.withDescription("How hard the reviewers think"),
    Flag.withDefault("high")
  ),
  floors: Flag.String("floors").pipe(
    Flag.withDescription(
      "The lowest score a category may have, for every reviewer: accessibility=80,states=70"
    ),
    Flag.optional
  ),
  goal: Flag.Int("goal").pipe(
    Flag.withDescription(
      "The score out of 100 every reviewer reaches before the loop stops; without it, every reviewer signs off"
    ),
    Flag.optional
  ),
  logFindings: Flag.Boolean("log-findings").pipe(
    Flag.withDescription(
      "Append every pass's findings to the findings log (~/.ultrapaint/findings/lab.jsonl, or ULTRAPAINT_FINDINGS)"
    )
  ),
  maxRounds: Flag.Int("max-rounds").pipe(
    Flag.withDescription(
      "Reviews of a section, or of the page, at most, whatever the goal: the safety cap"
    ),
    Flag.withDefault(6)
  ),
  review: Flag.ChoiceWithValue(
    "review",
    REVIEW_MODES.map((m) => [m, m] as const)
  ).pipe(
    Flag.withDescription(
      "Review the design in its loop: `end` reviews the page when the designer's turn ends, `each-section` each section as it is built; none without it"
    ),
    Flag.optional
  ),
  reviewerGoals: Flag.String("reviewer-goals").pipe(
    Flag.withDescription(
      "A reviewer's own target, or none to only advise: gpt-6.1-sol=none,cursor:grok-4.7-high=80"
    ),
    Flag.optional
  ),
  reviewers: Flag.String("reviewers").pipe(
    Flag.withDescription(
      "The council: the models that review, comma-separated: opus, gpt-6.1-sol, cursor:<a model of cursor-agent --list-models>"
    ),
    Flag.withDefault("opus")
  ),
};

/** `opus, gpt-6.1-sol` → the models, each once. */
const modelList = (list: string) => [
  ...new Set(
    list
      .split(",")
      .map((m) => m.trim())
      .filter((m) => m.length > 0)
  ),
];

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
  readonly budget: Option.Option<number>;
  readonly concurrency: number;
  readonly effort: string;
  readonly floors: Option.Option<string>;
  readonly goal: Option.Option<number>;
  readonly host: string;
  readonly judgeModel: string;
  readonly logFindings: boolean;
  readonly maxRounds: number;
  readonly minutes: number;
  readonly name: string;
  readonly picture: boolean;
  readonly prompt: Option.Option<string>;
  readonly refs: readonly string[];
  readonly review: Option.Option<ReviewMode>;
  readonly reviewerGoals: Option.Option<string>;
  readonly reviewers: string;
  readonly runs: number;
  readonly skills: Option.Option<string>;
}

const runGenerate = Effect.fn("runGenerate")(function* (input: GenerateInput) {
  const goal = yield* goalFrom({
    budgetUsd: Option.getOrUndefined(input.budget),
    floors: Option.getOrUndefined(input.floors),
    maxRounds: input.maxRounds,
    reviewerGoals: Option.getOrUndefined(input.reviewerGoals),
    score: Option.getOrUndefined(input.goal),
  });
  yield* generate(yield* loadReferences(input.refs), {
    agent: input.agent,
    host: input.host,
    minutes: input.minutes,
    model: Option.getOrUndefined(input.agentModel),
    picture: input.picture,
    prompt: Option.getOrUndefined(input.prompt),
    review: Option.getOrUndefined(
      Option.map(input.review, (mode) => ({
        concurrency: input.concurrency,
        effort: input.effort,
        goal,
        judgeModel: input.judgeModel,
        logFindings: input.logFindings,
        mode,
        reviewers: modelList(input.reviewers),
      }))
    ),
    round: input.name,
    runs: input.runs,
    skills: Option.getOrUndefined(input.skills),
  });
});

const generateCommand = Command.make(
  "generate",
  { name, refs, ...generateFlags, ...reviewFlags, ...judgeFlags },
  runGenerate
).pipe(
  Command.withDescription(
    "Have an agent design each reference from its brief, in Ultrapaint"
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
  { name, refs, ...generateFlags, ...reviewFlags, ...judgeFlags },
  Effect.fn(function* (input) {
    yield* runGenerate(input);
    yield* judge(input.name, {
      concurrency: input.concurrency,
      force: false,
      model: input.judgeModel,
    });
    yield* report(input.name, { model: input.judgeModel });
    // So the review can compare them part by part.
    yield* sections([input.name], {
      concurrency: input.concurrency,
      force: false,
      model: input.judgeModel,
    });
  })
).pipe(
  Command.withDescription(
    "Generate, judge and report: one round, resumed where it stopped"
  ),
  Command.provide(Browser.layer)
);

const setupHostCommand = Command.make(
  "setup-host",
  {
    agent: generateFlags.agent,
    agentModel: generateFlags.agentModel,
    host: Argument.String("host").pipe(
      Argument.withDescription(
        "The project under hosts/ to import the design system of"
      )
    ),
    minutes: generateFlags.minutes,
  },
  Effect.fn(function* (input) {
    yield* setupHost(input.host, {
      agent: input.agent,
      minutes: input.minutes,
      model: Option.getOrUndefined(input.agentModel),
    });
  })
).pipe(
  Command.withDescription(
    "Import a host's design system the way a user would, with Ultrapaint's /init"
  ),
  Command.provide(Browser.layer)
);

const judgeComponentsCommand = Command.make(
  "judge-components",
  {
    against: Flag.String("against").pipe(
      Flag.withDescription(
        "An earlier Track A round: each component is set against the version picked there"
      ),
      Flag.optional
    ),
    concurrency: judgeFlags.concurrency,
    judgeModel: judgeFlags.judgeModel,
    name,
  },
  Effect.fn(function* (input) {
    yield* judgeComponents(input.name, {
      against: Option.getOrUndefined(input.against),
      concurrency: input.concurrency,
      model: input.judgeModel,
    });
  })
).pipe(
  Command.withDescription(
    "Judge a Track A round's components against the product's, and an earlier round's picks"
  )
);

const extractCommand = Command.make(
  "extract",
  {
    agent: generateFlags.agent,
    agentModel: generateFlags.agentModel,
    judgeModel: judgeFlags.judgeModel,
    minutes: generateFlags.minutes,
    name,
    // Positional arguments are read in the order of their keys, sorted: `name`, then `of`.
    of: Argument.String("families").pipe(
      Argument.withDescription("Families of references; all when none"),
      Argument.variadic()
    ),
    runs: generateFlags.runs,
  },
  Effect.fn(function* (input) {
    yield* extract(input.of, {
      agent: input.agent,
      judgeModel: input.judgeModel,
      minutes: input.minutes,
      model: Option.getOrUndefined(input.agentModel),
      round: input.name,
      runs: input.runs,
    });
  })
).pipe(
  Command.withDescription(
    "Track A: have agents make each family's design system from its screens, several times"
  ),
  Command.provide(Browser.layer)
);

const freezeCommand = Command.make(
  "freeze",
  {
    family: Argument.String("family").pipe(
      Argument.withDescription("The family whose library it becomes")
    ),
    name,
    run: Argument.Int("run").pipe(
      Argument.withDescription("The run whose design system is kept")
    ),
  },
  Effect.fn(function* (input) {
    yield* freeze(input.name, input.family, input.run);
  })
).pipe(
  Command.withDescription(
    "Make an extraction run's design system a family's library (hosts/<family>), for track B"
  )
);

const sectionsCommand = Command.make(
  "sections",
  {
    concurrency: judgeFlags.concurrency,
    force,
    model: model("opus", "that marks the sections"),
    rounds: Argument.String("rounds").pipe(
      Argument.withDescription("Rounds whose designs to cut into sections"),
      Argument.atLeast(1)
    ),
  },
  Effect.fn(function* (input) {
    yield* sections(input.rounds, {
      concurrency: input.concurrency,
      force: input.force,
      model: input.model,
    });
  })
).pipe(
  Command.withDescription(
    "Mark each reference's sections and find them in each design, so they can be compared one by one"
  ),
  Command.provide(Browser.layer)
);

const reviewCommand = Command.make(
  "review",
  {
    host: Flag.String("host").pipe(
      Flag.withDescription(
        "The address the viewer listens on: 127.0.0.1, or a Tailscale address to open it from another device"
      ),
      Flag.withDefault("127.0.0.1")
    ),
    port: Flag.Int("port").pipe(
      Flag.withDescription("The port the viewer is served on"),
      Flag.withDefault(4477)
    ),
    rounds: Argument.String("rounds").pipe(
      Argument.withDescription(
        "Rounds to review; two or more also compare their designs pair by pair"
      ),
      Argument.atLeast(1)
    ),
  },
  Effect.fn(function* (input) {
    yield* review(input.rounds, { host: input.host, port: input.port });
  })
).pipe(
  Command.withDescription(
    "Swipe through what rounds made: screens, pairs, the judge's findings, the text agents added"
  )
);

const galleryCommand = Command.make(
  "gallery",
  {
    host: Flag.String("host").pipe(
      Flag.withDescription(
        "The address it listens on: 127.0.0.1, or a Tailscale address"
      ),
      Flag.withDefault("127.0.0.1")
    ),
    port: Flag.Int("port").pipe(
      Flag.withDescription("The port the page is served on"),
      Flag.withDefault(4478)
    ),
    set: Flag.ChoiceWithValue(
      "set",
      GALLERY_SETS.map((s) => [s, s] as const)
    ).pipe(
      Flag.withDescription(
        "shots: the shots to take references from; shadcn: shadcn's looks, to like or skip"
      ),
      Flag.withDefault("shots" as const)
    ),
  },
  Effect.fn(function* (input) {
    return yield* gallery({
      host: input.host,
      port: input.port,
      set: input.set,
    });
  })
).pipe(
  Command.withDescription(
    "A page of every shot of the sources, to choose the ones to take references from"
  )
);

const studyCommand = Command.make("study").pipe(
  Command.withDescription(
    "What the library of well-made sites says about each dimension of design, counted"
  ),
  Command.withSubcommands([
    Command.make(
      "annotate",
      {
        batch: Flag.Int("batch").pipe(
          Flag.withDescription("Sites looked at per call"),
          Flag.withDefault(3)
        ),
        concurrency: judgeFlags.concurrency,
        effort: Flag.String("effort").pipe(
          Flag.withDescription(
            "The reasoning effort, for a model in Codex or Cursor"
          ),
          Flag.withDefault("medium")
        ),
        limit: Flag.Int("limit").pipe(
          Flag.withDescription("At most this many sites this time"),
          Flag.withDefault(300)
        ),
        model: Flag.String("model").pipe(
          Flag.withDescription(
            "The model that looks at the sites: a gpt- model runs in Codex, cursor-opus-5.5 in Cursor, any other in Claude"
          ),
          Flag.withDefault("gpt-6.1-sol")
        ),
        sources: Flag.String("sources").pipe(
          Flag.withDescription(
            "The library's sources, comma-separated: opl,typewolf,awwwards,landing"
          ),
          Flag.withDefault("opl,typewolf,awwwards,landing")
        ),
      },
      Effect.fn(function* (input) {
        yield* studyAnnotate({
          batch: input.batch,
          concurrency: input.concurrency,
          effort: input.effort,
          limit: input.limit,
          model: input.model,
          sources: input.sources.split(","),
        });
      })
    ).pipe(
      Command.withDescription(
        "Look at each site not yet looked at, every dimension at once"
      )
    ),
    Command.make(
      "book",
      {
        character: Flag.String("character").pipe(
          Flag.withDescription(
            "Only the sites of one character: technical, humanistic, expressive"
          ),
          Flag.optional
        ),
        dimension: Flag.ChoiceWithValue(
          "dimension",
          DIMENSIONS.map((d) => [d, d] as const)
        ),
        model: model("opus", "that writes the reference"),
        notes: Flag.String("notes").pipe(
          Flag.withDescription(
            "The model whose study notes it is written from"
          ),
          Flag.withDefault("gpt-6.1-sol")
        ),
        skillsFrom: Flag.String("skills-from").pipe(
          Flag.withDescription(
            "A round whose recorded skills the reference is set against"
          ),
          Flag.withDefault("compose-r6")
        ),
      },
      Effect.fn(function* (input) {
        yield* studyBook({
          character: Option.getOrUndefined(input.character),
          dimension: input.dimension,
          model: input.model,
          notes: input.notes,
          skillsFrom: input.skillsFrom,
        });
      })
    ).pipe(
      Command.withDescription(
        "Write a dimension's reference from the counts and notes"
      )
    ),
  ])
);

const corpusFlag = Flag.ChoiceWithValue(
  "corpus",
  CORPUS_NAMES.map((c) => [c, c] as const)
).pipe(
  Flag.withDescription(
    "The corpus studied: untitled-ui, or landing (SaaS landing pages)"
  ),
  Flag.withDefault("untitled-ui")
);

const patternsCommand = Command.make("patterns").pipe(
  Command.withDescription(
    "How a well-made product builds its interface, counted over every picture of it"
  ),
  Command.withSubcommands([
    Command.make(
      "annotate",
      {
        batch: Flag.Int("batch").pipe(
          Flag.withDescription("Pictures looked at per call"),
          Flag.withDefault(6)
        ),
        concurrency: judgeFlags.concurrency,
        corpus: corpusFlag,
        limit: Flag.Int("limit").pipe(
          Flag.withDescription("At most this many pictures this time"),
          Flag.withDefault(10_000)
        ),
        model: model("opus", "that looks at the pictures"),
      },
      Effect.fn(function* (input) {
        yield* annotate({
          batch: input.batch,
          concurrency: input.concurrency,
          corpus: input.corpus,
          limit: input.limit,
          model: input.model,
        });
      })
    ).pipe(
      Command.withDescription(
        "Look at each picture not yet looked at, and note its patterns"
      )
    ),
    Command.make(
      "book",
      {
        corpus: corpusFlag,
        model: model("opus", "that writes the book"),
        skillsFrom: Flag.String("skills-from").pipe(
          Flag.withDescription(
            "A round whose recorded skills the book is set against"
          ),
          Flag.withDefault("compose-r1")
        ),
      },
      Effect.fn(function* (input) {
        yield* book({
          corpus: input.corpus,
          model: input.model,
          skillsFrom: input.skillsFrom,
        });
      })
    ).pipe(
      Command.withDescription(
        "Count the notes per kind of piece and write the pattern book"
      )
    ),
  ])
);

const learnCommand = Command.make(
  "learn",
  {
    against: Flag.String("against").pipe(
      Flag.withDescription(
        "The rounds a candidate round was reviewed against, comma-separated, oldest first"
      ),
      Flag.optional
    ),
    judgeModel: judgeFlags.judgeModel,
    name,
  },
  Effect.fn(function* (input) {
    yield* learn(input.name, {
      against: Option.getOrUndefined(input.against),
      model: input.judgeModel,
    });
  })
).pipe(
  Command.withDescription(
    "Read your picks of a round: what the winners do that the others do not, as rules"
  )
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

const pairwiseCommand = Command.make(
  "pairwise",
  {
    a: Argument.String("a").pipe(Argument.withDescription("A round")),
    b: Argument.String("b").pipe(
      Argument.withDescription("The round to set against it, run by run")
    ),
    judgeModel: judgeFlags.judgeModel,
  },
  Effect.fn(function* (input) {
    yield* pairwise(input.a, input.b, { model: input.judgeModel });
  })
).pipe(
  Command.withDescription(
    "Two rounds judged blind, run by run: which design is better, level by level"
  )
);

const decideCommand = Command.make(
  "decide",
  {
    deck: Argument.String("deck").pipe(
      Argument.withDescription(
        "A deck of decisions: decisions/<deck>.json in the data directory"
      )
    ),
    host: Flag.String("host").pipe(
      Flag.withDescription(
        "The address the page listens on: 127.0.0.1, or a Tailscale address to answer from another device"
      ),
      Flag.withDefault("127.0.0.1")
    ),
    port: Flag.Int("port").pipe(
      Flag.withDescription("The port the page is served on"),
      Flag.withDefault(4480)
    ),
  },
  Effect.fn(function* (input) {
    return yield* decide(input.deck, {
      host: input.host,
      port: input.port,
    });
  })
).pipe(
  Command.withDescription(
    "The decisions an agent needs from you, one card at a time, answered by a key; answers saved as you go"
  )
);

const measureCommand = Command.make(
  "measure",
  {
    out: Flag.String("out").pipe(
      Flag.withDescription("A JSON file the findings are written to"),
      Flag.optional
    ),
    ratio: Flag.Finite("ratio").pipe(
      Flag.withDescription(
        "How many times the gap inside a group the gap between groups must be"
      ),
      Flag.withDefault(3)
    ),
    root: Flag.String("root").pipe(
      Flag.withDescription("A CSS selector: the part of the page to measure"),
      Flag.withDefault("body")
    ),
    steps: Flag.String("steps").pipe(
      Flag.withDescription(
        "A module of steps run on the page first: export default [async (page) => {}]"
      ),
      Flag.optional
    ),
    theme: Flag.ChoiceWithValue("theme", [
      ["dark", "dark"],
      ["light", "light"],
    ] as const).pipe(
      Flag.withDescription("The colour scheme the page is opened in"),
      Flag.withDefault("dark" as const)
    ),
    url: Argument.String("url").pipe(
      Argument.withDescription("The page to measure, rendered in Chrome")
    ),
  },
  Effect.fn(function* (input) {
    yield* measure(input.url, {
      out: Option.getOrUndefined(input.out),
      ratio: input.ratio,
      root: input.root,
      steps: Option.getOrUndefined(input.steps),
      theme: input.theme,
    });
  })
).pipe(
  Command.withDescription(
    "Measure a rendered page: groups at least twice as far apart as the lines inside them, dividers on their bar's line"
  ),
  Command.provide(Browser.layer)
);

const gapsCommand = Command.make("gaps", {}, listGaps).pipe(
  Command.withDescription(
    "The design gaps of evals/gaps/: id, kind, status, title and the sections recall reviews"
  )
);

const recallCommand = Command.make(
  "recall",
  {
    concurrency: judgeFlags.concurrency,
    effort: Flag.String("effort").pipe(
      Flag.withDescription("How hard the reviewers and judges think"),
      Flag.withDefault("high")
    ),
    judgeModel: judgeFlags.judgeModel,
    models: Flag.String("models").pipe(
      Flag.withDescription(
        "The models that review, comma-separated, each with every version of the skill: opus, gpt-6.1-sol, cursor:<a model of cursor-agent --list-models>"
      ),
      Flag.withDefault("opus")
    ),
    name,
    runs: Flag.Int("runs").pipe(
      Flag.withDescription("Reviews per section, version and model"),
      Flag.withDefault(2)
    ),
    // Positional arguments are read in the order of their keys, sorted: `name`, then `sections`.
    sections: Argument.String("sections").pipe(
      Argument.withDescription(
        "Sections of the data directory's gaps/sections/; all when none"
      ),
      Argument.variadic()
    ),
    skills: Flag.String("skills").pipe(
      Flag.withDescription(
        "The versions of the skill, comma-separated: built-in, candidates/<fix>"
      ),
      Flag.withDefault("built-in")
    ),
  },
  Effect.fn(function* (input) {
    yield* recall({
      concurrency: input.concurrency,
      effort: input.effort,
      judgeModel: input.judgeModel,
      models: modelList(input.models),
      round: input.name,
      runs: input.runs,
      sections: input.sections,
      skills: input.skills.split(",").map((s) => s.trim()),
    });
  })
).pipe(
  Command.withDescription(
    "Have reviewers with each version of the skill review the gaps' sections, and count what they found of the person's findings"
  )
);

const panelCommand = Command.make(
  "panel",
  {
    concurrency: judgeFlags.concurrency,
    effort: reviewFlags.effort,
    judgeModel: judgeFlags.judgeModel,
    models: Flag.String("models").pipe(
      Flag.withDescription(
        "The panel: the models that review every section of every run, comma-separated (opus, gpt-6.1-sol, cursor:grok-4.7-high)"
      ),
      Flag.withDefault("opus")
    ),
    rounds: Argument.String("rounds").pipe(
      Argument.withDescription(
        "Rounds whose finished designs the panel reviews"
      ),
      Argument.atLeast(1)
    ),
  },
  Effect.fn(function* (input) {
    yield* panel(input.rounds, {
      concurrency: input.concurrency,
      effort: input.effort,
      judgeModel: input.judgeModel,
      models: modelList(input.models),
    });
  })
).pipe(
  Command.withDescription(
    "Score finished designs by what a fixed panel of fresh reviewers still finds in each section"
  ),
  Command.provide(Browser.layer)
);

Command.make("design-evals").pipe(
  Command.withDescription(
    "Find what the shipped design skills fail to teach, by remaking good screens and comparing"
  ),
  Command.withSubcommands([
    captureCommand,
    briefCommand,
    setupHostCommand,
    roundCommand,
    generateCommand,
    judgeCommand,
    reportCommand,
    galleryCommand,
    patternsCommand,
    extractCommand,
    judgeComponentsCommand,
    studyCommand,
    freezeCommand,
    sectionsCommand,
    reviewCommand,
    learnCommand,
    compareCommand,
    pairwiseCommand,
    gapsCommand,
    recallCommand,
    panelCommand,
    decideCommand,
    measureCommand,
  ]),
  Command.run({ version: "0.0.0" }),
  Effect.provide(
    Models.layer.pipe(
      Layer.provideMerge(NodeServices.layer),
      // The only place the evals read their environment.
      Layer.provideMerge(EvalsConfig.layerFrom(process.env))
    )
  ),
  NodeRuntime.runMain
);
