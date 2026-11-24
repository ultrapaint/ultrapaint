import { constants } from "node:fs";
import { access, stat } from "node:fs/promises";
import path from "node:path";
import { BUILT_IN_AGENTS } from "@ultrapaint/acp/built-in";
import { CommandFailed } from "@ultrapaint/contracts/errors";
import {
  OUTSIDE_AGENTS,
  type OutsideAgent,
  type OutsideAgentConnected,
  type OutsideAgentLine,
  type OutsideAgents as OutsideAgentsState,
  outsideLine,
  ULTRAPAINT_COMMAND,
} from "@ultrapaint/contracts/outside-agents";
import type { BuiltInAgentId } from "@ultrapaint/contracts/threads";
import { Context, type Duration, Effect, Layer, Option, Ref } from "effect";
import { ChildProcessSpawner } from "effect/process";
import { ServerConfig } from "../config.ts";
import { type CommandResult, runCommand } from "../process.ts";

/** A command run, as the test adapter keeps it. */
export interface Ran {
  readonly args: readonly string[];
  readonly command: string;
  readonly cwd: string;
}

/** The machine the test adapter plays. */
export interface FakeMachine {
  /** What a command answers, or undefined for one that does not answer in time. */
  readonly answer?: (ran: Ran) => CommandResult | undefined;
  /** The programs on its PATH, by name, at their paths. */
  readonly programs?: Readonly<Record<string, string>>;
}

/** How the service reaches the machine the server runs on. */
interface Machine {
  /** Where a program is on the server's PATH. */
  readonly find: (program: string) => Effect.Effect<Option.Option<string>>;
  /** A command run to its end; one that cannot start or does not end in time fails. */
  readonly run: (
    ran: Ran,
    timeout: Duration.Input
  ) => Effect.Effect<CommandResult, CommandFailed>;
}

/**
 * How long an agent has to say whether it lists Ultrapaint, and to register it. Claude Code's
 * `mcp get` health-checks the server it names, starting `ultrapaint mcp`, and tries twice: about
 * 10 seconds against one that never answers.
 */
const GET_TIMEOUT = "30 seconds";
const ADD_TIMEOUT = "30 seconds";

/** What a command that did not end in time is answered with. */
const noAnswer = (command: string, timeout: Duration.Input) =>
  new CommandFailed({
    message: `${path.basename(command)} didn’t answer in ${timeout}.`,
  });

/** What a command that failed said: its errors, else what it printed. */
const messageOf = (result: CommandResult, line: string) =>
  result.stderr.trim() ||
  result.stdout.trim() ||
  `${line} exited with ${result.exitCode}.`;

/** Whether `file` is a file this user may run. */
const isExecutable = (file: string) =>
  Effect.tryPromise(async () => {
    const info = await stat(file);
    await access(file, constants.X_OK);
    return info.isFile();
  }).pipe(Effect.orElseSucceed(() => false));

const make = (machine: Machine, ran: Effect.Effect<readonly Ran[]>) =>
  Effect.gen(function* () {
    const config = yield* ServerConfig;
    const { home } = config.machine;
    const runtime = config.agentRuntime;

    /**
     * The person's own program for the agent: the one the desktop app found, else the one on the
     * server's PATH. The copy the app downloaded for its threads is not theirs to run.
     */
    const programOf = (line: OutsideAgentLine) => {
      const found = runtime?.agents[line.id];
      if (found?.downloaded) {
        return Effect.succeed(Option.none<string>());
      }
      const executable = found?.env[BUILT_IN_AGENTS[line.id].executable.env];
      return executable === undefined
        ? machine.find(line.program)
        : Effect.succeed(Option.some(executable));
    };

    const commandOnPath = Effect.map(
      machine.find(ULTRAPAINT_COMMAND),
      Option.isSome
    );

    /** Where an agent stands, as it answers its own `mcp get` now. */
    const statusOf = Effect.fnUntraced(function* (line: OutsideAgentLine) {
      const program = yield* programOf(line);
      if (Option.isNone(program)) {
        return {
          id: line.id,
          install: BUILT_IN_AGENTS[line.id].executable.install,
          status: "not-installed",
        } satisfies OutsideAgent;
      }
      return yield* machine
        .run({ args: line.get, command: program.value, cwd: home }, GET_TIMEOUT)
        .pipe(
          Effect.map((result): OutsideAgent => {
            // 0 lists it and 1 does not; anything else is the agent failing to say.
            if (result.exitCode === 0 || result.exitCode === 1) {
              return {
                id: line.id,
                status: result.exitCode === 0 ? "connected" : "not-connected",
              };
            }
            return {
              id: line.id,
              message: messageOf(
                result,
                `${line.program} ${line.get.join(" ")}`
              ),
              status: "unanswered",
            };
          }),
          // Not knowing is an answer of its own, said on its row.
          Effect.catchTag("CommandFailed", (failed) =>
            Effect.succeed<OutsideAgent>({
              id: line.id,
              message: failed.message,
              status: "unanswered",
            })
          )
        );
    });

    const connect = Effect.fn("OutsideAgents.connect")(function* (
      id: BuiltInAgentId
    ) {
      const line = OUTSIDE_AGENTS.find((a) => a.id === id);
      if (line === undefined) {
        return yield* new CommandFailed({
          message: `Ultrapaint doesn’t know how to connect ${id}.`,
        });
      }
      const program = yield* programOf(line);
      if (Option.isNone(program)) {
        return yield* new CommandFailed({
          message: `${line.name} isn’t installed on this computer.`,
        });
      }
      const result = yield* machine.run(
        { args: line.add, command: program.value, cwd: home },
        ADD_TIMEOUT
      );
      if (result.exitCode !== 0) {
        return yield* new CommandFailed({
          message: messageOf(result, outsideLine(line)),
        });
      }
      const agent = yield* statusOf(line);
      if (agent.status === "not-connected") {
        return yield* new CommandFailed({
          message: `\`${outsideLine(line)}\` ran, but ${line.name} still doesn’t list Ultrapaint.`,
        });
      }
      return {
        agent,
        commandOnPath: yield* commandOnPath,
      } satisfies OutsideAgentConnected;
    });

    return OutsideAgents.of({
      connect,
      ran,
      state: Effect.gen(function* () {
        const [agents, onPath] = yield* Effect.all(
          [
            Effect.all(OUTSIDE_AGENTS.map(statusOf), {
              concurrency: "unbounded",
            }),
            commandOnPath,
          ],
          { concurrency: "unbounded" }
        );
        return { agents, commandOnPath: onPath } satisfies OutsideAgentsState;
      }),
    });
  });

/**
 * The outside agents Settings › Connections connects (ADR 0144): whether each one, Claude Code and
 * Codex, is installed on the server's machine and lists Ultrapaint, as the agent itself answers
 * (`mcp get ultrapaint`, in the home folder, so that a registration scoped to one project does
 * not count), and connecting it by running its own registration line there. Ultrapaint changes
 * an agent's settings in this one place, by the agent's own command, and keeps no record of it.
 * The commands run as the server's own children, so the desktop app, a browser and an SSH
 * project connect the agent on the machine the project is on (ADR 0083).
 */
export class OutsideAgents extends Context.Service<
  OutsideAgents,
  {
    /** Runs the agent's own registration line, then asks it again. */
    readonly connect: (
      id: BuiltInAgentId
    ) => Effect.Effect<OutsideAgentConnected, CommandFailed>;
    /** The commands the test adapter ran, in order; always empty for the real one. */
    readonly ran: Effect.Effect<readonly Ran[]>;
    /** Each agent as it answers now, and whether `ultrapaint` is on the PATH. */
    readonly state: Effect.Effect<OutsideAgentsState>;
  }
>()("ultrapaint/server/OutsideAgents") {
  static readonly layer = Layer.effect(
    OutsideAgents,
    Effect.gen(function* () {
      const config = yield* ServerConfig;
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
      const dirs = config.machine.path.split(path.delimiter).filter(Boolean);
      return yield* make(
        {
          find: Effect.fnUntraced(function* (program: string) {
            for (const dir of dirs) {
              const candidate = path.join(dir, program);
              if (yield* isExecutable(candidate)) {
                return Option.some(candidate);
              }
            }
            return Option.none<string>();
          }),
          run: ({ args, command, cwd }, timeout) =>
            runCommand(command, args, { cwd, timeout }).pipe(
              Effect.provideService(
                ChildProcessSpawner.ChildProcessSpawner,
                spawner
              ),
              Effect.mapError((cause) =>
                cause._tag === "TimeoutError"
                  ? noAnswer(command, timeout)
                  : new CommandFailed({ message: cause.message })
              )
            ),
        },
        Effect.succeed([])
      );
    })
  );

  /**
   * The service on a machine a test plays: its programs, and what each command answers (exit 1
   * when the test says nothing); keeps what was run, for the test to read.
   */
  static readonly layerTest = (machine: FakeMachine) =>
    Layer.effect(
      OutsideAgents,
      Effect.gen(function* () {
        const ran = yield* Ref.make<readonly Ran[]>([]);
        const programs = machine.programs ?? {};
        return yield* make(
          {
            find: (program) =>
              Effect.succeed(Option.fromNullishOr(programs[program])),
            run: (command, timeout) =>
              Effect.gen(function* () {
                yield* Ref.update(ran, (all) => [...all, command]);
                const answer = machine.answer
                  ? machine.answer(command)
                  : { exitCode: 1, stderr: "", stdout: "" };
                if (answer === undefined) {
                  return yield* noAnswer(command.command, timeout);
                }
                return answer;
              }),
          },
          Ref.get(ran)
        );
      })
    );
}
