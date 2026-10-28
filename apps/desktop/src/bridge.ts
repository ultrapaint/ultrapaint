/**
 * The preload script's side of the shell bridge (`@ultrapaint/contracts/shell-bridge`): the
 * channels and the object the editor's page is given as `window.ultrapaintPlatform`, built from
 * the capabilities the main process says are shown (`bridge-server.ts`). It knows no capability
 * by name: a new one in the table reaches the page with no change here.
 *
 * Takes only types from the table, so the preload carries no Schema: the main process decodes
 * what the page sends, and the page is not slowed by a library it does not run.
 */
import type {
  CapabilityName,
  ShellPlatform,
  StateSource,
} from "@ultrapaint/contracts/shell-bridge";

/** The channel a capability is called or told on. */
export const channelOf = (name: CapabilityName) => `ultrapaint:${name}`;

/** Where a call that reports progress tells its steps. */
export const progressChannelOf = (name: CapabilityName) =>
  `${channelOf(name)}:progress`;

/** Synchronous, as the page loads: what the page is shown (`BridgeInfo`). */
export const INFO_CHANNEL = "ultrapaint:bridge-info";

/** From the page, every `BEAT_MS`: its thread runs (`stuck-pages.ts` ends a script that holds it). */
export const BEAT_CHANNEL = "ultrapaint:beat";

/** How often the page beats on `BEAT_CHANNEL`. */
export const BEAT_MS = 250;

/** A capability the page is shown, as the main process names it for the preload. */
export type ShownCapability =
  | {
      readonly kind: "invoke";
      readonly name: CapabilityName;
      /** It takes a listener after its arguments, told each step on its progress channel. */
      readonly progress: boolean;
    }
  | {
      readonly kind: "state";
      readonly name: CapabilityName;
      /** Its value as the page loads, encoded. */
      readonly value: unknown;
    };

/** What the preload script asks before the page loads. */
export interface BridgeInfo {
  readonly shown: readonly ShownCapability[];
}

/** What of Electron's `ipcRenderer` the bridge uses. */
export interface RendererIpc {
  readonly invoke: (channel: string, ...args: unknown[]) => Promise<unknown>;
  readonly off: (
    channel: string,
    listener: (event: unknown, payload: unknown) => void
  ) => void;
  readonly on: (
    channel: string,
    listener: (event: unknown, payload: unknown) => void
  ) => void;
}

type Listener = (value: unknown) => void;

const invokeOf =
  (ipc: RendererIpc, name: CapabilityName) =>
  (...args: unknown[]) =>
    ipc.invoke(channelOf(name), ...args);

/** A call whose steps reach the listener given last, which goes once it is answered. */
const invokeWithProgress =
  (ipc: RendererIpc, name: CapabilityName) =>
  async (...args: unknown[]) => {
    const onProgress = args.at(-1) as Listener;
    const listener = (_event: unknown, progress: unknown) =>
      onProgress(progress);
    ipc.on(progressChannelOf(name), listener);
    try {
      return await ipc.invoke(channelOf(name), ...args.slice(0, -1));
    } finally {
      ipc.off(progressChannelOf(name), listener);
    }
  };

const stateOf = (
  ipc: RendererIpc,
  name: CapabilityName,
  initial: unknown
): StateSource<unknown> => {
  let value = initial;
  const listeners = new Set<Listener>();
  ipc.on(channelOf(name), (_event, next) => {
    value = next;
    for (const listener of listeners) {
      listener(next);
    }
  });
  return {
    current: () => value,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
};

/**
 * The object the page is given: each capability shown at its path (`projects.open` in
 * `projects`). Typed by the table: what is built at a name is what `Exposed` says a capability of
 * its kind is (`bridge.test.ts`); what is not shown is absent.
 */
export const exposeBridge = (
  ipc: RendererIpc,
  info: BridgeInfo
): Partial<ShellPlatform> => {
  const exposed: Record<string, unknown> = {};
  for (const shown of info.shown) {
    const path = shown.name.split(".");
    const last = path.pop() ?? shown.name;
    let into = exposed;
    for (const part of path) {
      into[part] ??= {};
      into = into[part] as Record<string, unknown>;
    }
    if (shown.kind === "state") {
      into[last] = stateOf(ipc, shown.name, shown.value);
    } else if (shown.progress) {
      into[last] = invokeWithProgress(ipc, shown.name);
    } else {
      into[last] = invokeOf(ipc, shown.name);
    }
  }
  return exposed as Partial<ShellPlatform>;
};
