import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { request as httpRequest } from "node:http";
import { connect } from "node:net";
import type { Duplex } from "node:stream";
import { Context, Effect, Layer } from "effect";
import {
  connectHost,
  hostNameOf,
  isAllowedHost,
  ServerConfig,
} from "./config.ts";

/**
 * The path the preview is served under, on the preview's server and on this one, which forwards
 * it there (ADR 0034): the editor imports the preview's modules from its own origin, and a
 * machine reached over SSH forwards one port.
 */
export const PREVIEW_BASE = "/preview/";

const isPreview = (url: string | undefined) =>
  url !== undefined &&
  (url === PREVIEW_BASE.slice(0, -1) || url.startsWith(PREVIEW_BASE));

/**
 * Forwards `/preview/` to the open project's preview server: its requests, and the socket of
 * its live updates. The preview's server listens on a port of its own that moves when it starts
 * again; this one does not. Done on the Node server itself, before the router: a response
 * streamed through as it comes, and an upgrade handed over as raw bytes.
 */
export class PreviewProxy extends Context.Service<
  PreviewProxy,
  {
    /** Hooks the forwarding into the HTTP server, ahead of everything else it does. */
    readonly attach: (server: Server) => void;
    /** Where the preview's server listens; null while there is none. */
    readonly setTarget: (port: number | null) => Effect.Effect<void>;
  }
>()("ultrapaint/server/PreviewProxy") {
  static readonly layer = Layer.effect(
    PreviewProxy,
    Effect.gen(function* () {
      const { allowedHosts, host, machine } = yield* ServerConfig;
      let target: number | null = null;
      const upstreamHost = connectHost(host).replace(/^\[|\]$/g, "");

      /** The same names the router lets in (`HostGuard`): no other site's page gets through. */
      const allowed = (req: IncomingMessage) => {
        const name = hostNameOf(req.headers.host ?? "");
        return (
          name !== undefined &&
          isAllowedHost(name, host, machine.addresses(), allowedHosts)
        );
      };

      const forward = (req: IncomingMessage, res: ServerResponse) => {
        if (!allowed(req)) {
          res.writeHead(403).end("host not allowed");
          return;
        }
        if (target === null) {
          res.writeHead(503).end("the preview is not running");
          return;
        }
        const upstream = httpRequest(
          {
            headers: { ...req.headers, host: `${upstreamHost}:${target}` },
            host: upstreamHost,
            method: req.method,
            path: req.url,
            port: target,
          },
          (answer) => {
            res.writeHead(answer.statusCode ?? 502, answer.headers);
            answer.pipe(res);
          }
        );
        upstream.on("error", () => {
          if (res.headersSent) {
            res.destroy();
          } else {
            res.writeHead(502).end("the preview did not answer");
          }
        });
        req.pipe(upstream);
      };

      const forwardUpgrade = (
        req: IncomingMessage,
        socket: Duplex,
        head: Buffer
      ) => {
        if (!allowed(req) || target === null) {
          socket.end("HTTP/1.1 503 Service Unavailable\r\n\r\n");
          return;
        }
        const upstream = connect(target, upstreamHost, () => {
          const lines = [`${req.method} ${req.url} HTTP/${req.httpVersion}`];
          for (let i = 0; i < req.rawHeaders.length; i += 2) {
            const name = req.rawHeaders[i] as string;
            const value =
              name.toLowerCase() === "host"
                ? `${upstreamHost}:${target}`
                : (req.rawHeaders[i + 1] as string);
            lines.push(`${name}: ${value}`);
          }
          upstream.write(`${lines.join("\r\n")}\r\n\r\n`);
          if (head.length > 0) {
            upstream.write(head);
          }
          socket.pipe(upstream);
          upstream.pipe(socket);
        });
        const close = () => {
          upstream.destroy();
          socket.destroy();
        };
        upstream.on("error", close);
        socket.on("error", close);
      };

      return PreviewProxy.of({
        attach: (server) => {
          const emit = server.emit.bind(server);
          server.emit = ((event: string | symbol, ...args: unknown[]) => {
            if (event === "request") {
              const [req, res] = args as [IncomingMessage, ServerResponse];
              if (isPreview(req.url)) {
                forward(req, res);
                return true;
              }
            } else if (event === "upgrade") {
              const [req, socket, head] = args as [
                IncomingMessage,
                Duplex,
                Buffer,
              ];
              if (isPreview(req.url)) {
                forwardUpgrade(req, socket, head);
                return true;
              }
            }
            return emit(event as string, ...args);
          }) as Server["emit"];
        },
        setTarget: (port) =>
          Effect.sync(() => {
            target = port;
          }),
      });
    })
  );
}
