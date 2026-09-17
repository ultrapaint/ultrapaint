import { decodeClientFrame, type EventName, type EventPayload } from "@ultrapaint/contracts";
import type { WebSocket, WebSocketServer } from "ws";
import type { AppContext } from "../context.ts";
import type { Router } from "../router.ts";

export const attachWebSocket = (wss: WebSocketServer, router: Router, ctx: AppContext) => {
  const clients = new Set<WebSocket>();

  ctx.events.subscribe((event, payload) => {
    const frame = JSON.stringify({ event, payload });
    for (const c of clients) if (c.readyState === c.OPEN) c.send(frame);
  });

  wss.on("connection", (ws, req) => {
    const origin = req.headers.origin;
    // Loopback only: accept no origin (native clients) or a local origin.
    if (origin && !/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(origin)) {
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
      if (frame._tag === "Left") {
        ws.send(
          JSON.stringify({
            id: (parsed as { id?: number })?.id ?? 0,
            ok: false,
            error: { code: "bad_request", message: "malformed frame" },
          }),
        );
        return;
      }
      const { id, method, input } = frame.right;
      const result = await router.dispatch(method, input);
      if (result.ok) ws.send(JSON.stringify({ id, ok: true, output: result.output ?? null }));
      else ws.send(JSON.stringify({ id, ok: false, error: result.error }));
    });
  });

  return {
    broadcast<E extends EventName>(event: E, payload: EventPayload<E>) {
      ctx.events.emit(event, payload);
    },
  };
};
