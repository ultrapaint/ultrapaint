import {
  decodeClientFrame,
  type EventName,
  type EventPayload,
} from "@ultrapaint/contracts/ipc";
import { Result } from "effect";
import type { WebSocket, WebSocketServer } from "ws";
import type { AppContext } from "../context.ts";
import type { Router } from "../router.ts";

const LOCAL_ORIGIN_RE = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

export const attachWebSocket = (
  wss: WebSocketServer,
  router: Router,
  ctx: AppContext
) => {
  const clients = new Set<WebSocket>();

  ctx.events.subscribe((event, payload) => {
    const frame = JSON.stringify({ event, payload });
    for (const c of clients) {
      if (c.readyState === c.OPEN) {
        c.send(frame);
      }
    }
  });

  wss.on("connection", (ws, req) => {
    const { origin } = req.headers;
    // Loopback only: accept no origin (native clients) or a local origin.
    if (origin && !LOCAL_ORIGIN_RE.test(origin)) {
      ws.close(1008, "origin not allowed");
      return;
    }
    clients.add(ws);
    ws.on("close", () => clients.delete(ws));
    ws.on("message", async (data) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(String(data));
      } catch {
        return;
      }
      const frame = decodeClientFrame(parsed);
      if (Result.isFailure(frame)) {
        ws.send(
          JSON.stringify({
            error: { code: "bad_request", message: "malformed frame" },
            id: (parsed as { id?: number } | null)?.id ?? 0,
            ok: false,
          })
        );
        return;
      }
      const { id, method, input } = frame.success;
      const result = await router.dispatch(method, input);
      if (result.ok) {
        ws.send(
          JSON.stringify({ id, ok: true, output: result.output ?? null })
        );
      } else {
        ws.send(JSON.stringify({ error: result.error, id, ok: false }));
      }
    });
  });

  return {
    broadcast<E extends EventName>(event: E, payload: EventPayload<E>) {
      ctx.events.emit(event, payload);
    },
  };
};
