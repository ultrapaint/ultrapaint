/**
 * The main process's side of the shell bridge (`@ultrapaint/contracts/shell-bridge`): one
 * handler per capability the page calls, registered from the table. A call is answered only for
 * the app's own window; its input is decoded by the capability's Schema (a `BridgeInputError`
 * otherwise), a capability the open project does not show is refused (`HiddenCapability`), the
 * handler runs, and its answer is encoded by the output's Schema. What fails reaches the page as
 * its message, which is all Electron carries.
 *
 * Nothing of Electron: `main.ts` hands it `ipcMain` and how its effects run.
 */
import {
  type Capability,
  type CapabilityName,
  type InvokeName,
  SHELL_BRIDGE,
  type ShellBridge,
  type StateName,
} from "@ultrapaint/contracts/shell-bridge";
import { Effect, Schema } from "effect";
import {
  type BridgeInfo,
  channelOf,
  progressChannelOf,
  type ShownCapability,
} from "./bridge.ts";
import { BridgeInputError, HiddenCapability } from "./errors.ts";

/** What a handler may fail with: something with a message for the user. */
interface BridgeFailure {
  readonly message: string;
}

/** A handler's arguments: the input decoded, and how to report a step for one with progress. */
type HandlerArgs<C> = C extends {
  readonly input: { readonly Type: infer I extends readonly unknown[] };
  readonly progress: infer P;
}
  ? P extends Schema.Constraint
    ? [...I, report: (progress: P["Type"]) => Effect.Effect<void>]
    : I
  : never;

type OutputOf<C> = C extends { readonly output: Schema.Constraint }
  ? C["output"]["Type"]
  : never;

/** How the main process answers each capability the page calls. */
export type BridgeHandlers<R> = {
  readonly [K in InvokeName]: (
    ...args: HandlerArgs<ShellBridge[K]>
  ) => Effect.Effect<OutputOf<ShellBridge[K]>, BridgeFailure, R>;
};

/** Each state's value as the main process holds it. */
type StateValues = { [K in StateName]: ShellBridge[K]["value"]["Type"] };
export type StateValue<K extends StateName> = StateValues[K];

/** The states the window has; one not given is not shown (`windowControls` off a Mac). */
export type BridgeStates = Partial<StateValues>;

/** Whether the open project shows a capability: this machine's are hidden for a remote one. */
const isShown = (name: CapabilityName, remote: boolean) =>
  !remote || SHELL_BRIDGE[name].remote;

const NAMES = Object.keys(SHELL_BRIDGE) as CapabilityName[];

const encodeState = (name: StateName, value: unknown) =>
  Schema.encodeUnknownSync(SHELL_BRIDGE[name].value)(value);

/** What the preload script is told as the page loads: what it shows, the states as they are. */
export const bridgeInfo = (
  remote: boolean,
  states: BridgeStates
): BridgeInfo => ({
  shown: NAMES.filter((name) => isShown(name, remote)).flatMap(
    (name): ShownCapability[] => {
      const capability: Capability = SHELL_BRIDGE[name];
      if (capability.kind === "invoke") {
        return [
          { kind: "invoke", name, progress: capability.progress !== undefined },
        ];
      }
      const value = states[name as StateName];
      return value === undefined
        ? []
        : [
            {
              kind: "state",
              name,
              value: encodeState(name as StateName, value),
            },
          ];
    }
  ),
});

/** A state's change, as the page is told it: its channel and its value encoded. */
export const stateMessage = <K extends StateName>(
  name: K,
  value: StateValue<K>
) => ({ channel: channelOf(name), value: encodeState(name, value) });

/** A handler as the server calls it, its arguments already decoded. */
type AnyHandler<R> = (
  ...args: readonly unknown[]
) => Effect.Effect<unknown, BridgeFailure, R>;

/**
 * Answers one call of the page: `args` as Electron delivered them, `report` sends a step of one
 * with progress. The answer encoded.
 */
export const answer =
  <R>(
    handlers: BridgeHandlers<R>,
    /** Whether the open project is on another machine. */
    remote: Effect.Effect<boolean, never, R>
  ) =>
  (
    name: InvokeName,
    args: readonly unknown[],
    report: (progress: unknown) => Effect.Effect<void>
  ): Effect.Effect<unknown, BridgeFailure, R> =>
    Effect.gen(function* () {
      const capability: ShellBridge[InvokeName] = SHELL_BRIDGE[name];
      if (!capability.remote && (yield* remote)) {
        return yield* new HiddenCapability({ capability: name });
      }
      const input = yield* Schema.decodeUnknownEffect(capability.input)(
        args
      ).pipe(
        Effect.mapError(
          (error) =>
            new BridgeInputError({ capability: name, message: error.message })
        )
      );
      const { progress } = capability;
      const reportEncoded = (step: unknown) =>
        progress === undefined
          ? Effect.void
          : Schema.encodeUnknownEffect(progress)(step).pipe(
              Effect.flatMap(report),
              // A step that does not encode is the app's mistake, not the page's.
              Effect.orDie
            );
      const handler = handlers[name] as AnyHandler<R>;
      const output = yield* handler(
        ...(progress === undefined ? input : [...input, reportEncoded])
      );
      return yield* Schema.encodeUnknownEffect(capability.output)(output).pipe(
        Effect.orDie
      );
    });

/** The sender of a call, as Electron gives it: a window's contents. */
export interface BridgeSender {
  readonly send: (channel: string, payload: unknown) => void;
}

/** What of Electron's `ipcMain` the server uses. */
interface MainIpc<Sender extends BridgeSender> {
  readonly handle: (
    channel: string,
    listener: (
      event: { readonly sender: Sender },
      ...args: unknown[]
    ) => Promise<unknown>
  ) => void;
}

/**
 * Registers every capability the page calls: only `fromWindow`'s calls are answered, each run by
 * `run` (the app's runtime), and the steps of a call with progress go back to its sender.
 */
export const serveBridge = <R, Sender extends BridgeSender>(options: {
  readonly fromWindow: (sender: Sender) => boolean;
  readonly handlers: BridgeHandlers<R>;
  readonly ipc: MainIpc<Sender>;
  readonly remote: Effect.Effect<boolean, never, R>;
  readonly run: <A, E>(effect: Effect.Effect<A, E, R>) => Promise<A>;
}) => {
  const respond = answer(options.handlers, options.remote);
  for (const name of NAMES) {
    if (SHELL_BRIDGE[name].kind !== "invoke") {
      continue;
    }
    const invoked = name as InvokeName;
    options.ipc.handle(channelOf(invoked), (event, ...args) => {
      if (!options.fromWindow(event.sender)) {
        return Promise.reject(new Error("not the app's window"));
      }
      return options.run(
        respond(invoked, args, (step) =>
          Effect.sync(() => event.sender.send(progressChannelOf(invoked), step))
        )
      );
    });
  }
};
