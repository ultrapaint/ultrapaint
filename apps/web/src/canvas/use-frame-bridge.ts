import type { HostMessage } from "@ultrapaint/contracts/preview";
import { useEffect, useEffectEvent } from "react";
import { bridgeFor, type FrameBridge } from "./bridge.ts";

/**
 * Hands what the frame `frameId` says to `onMessage` while it is drawn in the editor's page (ADR
 * 0034), and says it is ready as soon as this listens: the frame was ready before. The bridge
 * stays when this stops listening: the pool (`preview-pool.ts`) keeps the frame and removes the
 * bridge when it drops it.
 */
export const useFrameBridge = (
  frameId: string | null,
  onMessage: (msg: HostMessage, bridge: FrameBridge) => void
) => {
  const handle = useEffectEvent(onMessage);
  useEffect(() => {
    if (frameId === null) {
      return;
    }
    const bridge = bridgeFor(frameId);
    const off = bridge.on((msg) => handle(msg, bridge));
    bridge.announce();
    return () => {
      off();
    };
  }, [frameId]);
};
