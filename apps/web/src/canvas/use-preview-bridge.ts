import type { HostMessage } from "@ultrapaint/contracts/preview";
import { type RefObject, useEffect, useEffectEvent } from "react";
import { bridgeFor, type FrameBridge, removeBridge } from "./bridge.ts";

/**
 * Attaches the bridge of `frameId` to the iframe in `iframe`, hands it what the preview sends,
 * and removes the bridge once the iframe goes. `frameId` is null while there is nothing to
 * attach to. `mount` changes whenever the iframe element may have been replaced (a new address,
 * a reload, the iframe mounted at last): the bridge is attached to whichever one is there, or
 * its `ed:ready` goes unheard.
 *
 * The bridge is looked up here and in handlers, never during render: the registry is mutable
 * (cleanup removes the entry), so a render-time lookup would be cached by React Compiler and go
 * stale.
 */
export const usePreviewBridge = (
  iframe: RefObject<HTMLIFrameElement | null>,
  frameId: string | null,
  mount: unknown,
  onMessage: (msg: HostMessage, bridge: FrameBridge) => void,
  onDetach?: () => void
) => {
  const handle = useEffectEvent(onMessage);
  const detached = useEffectEvent(() => onDetach?.());
  // biome-ignore lint/correctness/useExhaustiveDependencies: the remount is the dependency.
  useEffect(() => {
    const el = iframe.current;
    if (!(el && frameId !== null)) {
      return;
    }
    const bridge = bridgeFor(frameId);
    bridge.attach(el);
    const off = bridge.on((msg) => handle(msg, bridge));
    return () => {
      off();
      removeBridge(frameId);
      detached();
    };
  }, [iframe, frameId, mount]);
};
