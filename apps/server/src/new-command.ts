/**
 * `ultrapaint new <folder>`: a new design from nothing (PLAN-desktop D11), written before any
 * server runs in it. The desktop app's New design dialog runs the same, with `--progress-json`,
 * and shows each line as a step.
 */
import path from "node:path";
import {
  type NewDesignProgress,
  NewDesignProgressLine,
} from "@ultrapaint/contracts/new-design";
import { Console, Effect, Layer, Option, Schema } from "effect";
import { Argument, Command, Flag } from "effect/cli";
import { NewDesignService } from "./services/new-design.ts";
import { SetupService } from "./services/setup.ts";

const encodeLine = Schema.encodeSync(NewDesignProgressLine);

const STEP_NAMES: Record<NewDesignProgress["step"], string> = {
  folder: "Making the folder",
  git: "Committing it to git",
  install: "Installing the packages",
  write: "Writing the project",
};

/** A line for whoever reads the terminal. */
const sayProgress = (progress: NewDesignProgress) => {
  if (progress.state === "active") {
    return Console.error(`[ultrapaint] ${STEP_NAMES[progress.step]}…`);
  }
  const detail = progress.detail ? `: ${progress.detail}` : "";
  return Console.error(`[ultrapaint]   ${progress.state}${detail}`);
};

export const newCommand = Command.make(
  "new",
  {
    code: Flag.Literals("code", ["app", "root"]).pipe(
      Flag.withDescription(
        "Where the application's code goes: an app directory beside the designs, or the folder's root"
      ),
      Flag.withDefault("app")
    ),
    folder: Argument.String("folder").pipe(
      Argument.withDescription(
        "The folder to write it in: made when it is not there, and empty otherwise"
      )
    ),
    git: Flag.Boolean("git").pipe(
      Flag.withDescription(
        "Turn the git integration on: git init, and a first commit"
      ),
      Flag.withDefault(false)
    ),
    name: Flag.String("name").pipe(
      Flag.withDescription("The design's name (default: the folder's)"),
      Flag.optional
    ),
    noInstall: Flag.Boolean("no-install").pipe(
      Flag.withDescription("Write the files, and leave installing them to you"),
      Flag.withDefault(false)
    ),
    packageManager: Flag.String("package-manager").pipe(
      Flag.withDescription(
        "The package manager to install with (default: pnpm when it is there, npm otherwise)"
      ),
      Flag.optional
    ),
    progressJson: Flag.Boolean("progress-json").pipe(
      Flag.withDescription(
        "Print each step as one line of JSON on stdout, as it starts and as it ends"
      ),
      Flag.withDefault(false)
    ),
    template: Flag.Literals("template", ["blank", "starter"]).pipe(
      Flag.withDescription(
        "blank: no components, a design system defined from nothing; starter: a component for each primitive"
      ),
      Flag.withDefault("blank")
    ),
  },
  Effect.fn(
    function* (input) {
      const folder = path.resolve(process.cwd(), input.folder);
      const name = Option.getOrElse(input.name, () => path.basename(folder));
      const report = (progress: NewDesignProgress) =>
        input.progressJson
          ? Console.log(encodeLine(progress))
          : sayProgress(progress);
      const service = yield* NewDesignService;
      yield* service
        .create(
          {
            code: input.code,
            folder,
            git: input.git,
            install: !input.noInstall,
            name,
            packageManager: Option.getOrUndefined(input.packageManager),
            template: input.template,
          },
          report
        )
        .pipe(
          Effect.matchEffect({
            // The step said why; what is written stays, and a second run finishes it.
            onFailure: () =>
              Effect.andThen(
                Console.error(
                  `[ultrapaint] ${name} is written as far as it got. Running the same again finishes it.`
                ),
                Effect.sync(() => {
                  process.exitCode = 1;
                })
              ),
            onSuccess: () =>
              Console.error(
                `[ultrapaint] ${name} is ready. Open it: cd ${JSON.stringify(folder)} && ultrapaint`
              ),
          })
        );
    },
    Effect.provide(
      NewDesignService.layer.pipe(Layer.provide(SetupService.layer))
    )
  )
).pipe(
  Command.withDescription(
    "Write a new design from nothing: a configuration, a designs directory and an application to design with"
  )
);
