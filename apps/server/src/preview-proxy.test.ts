import { createServer, request, type Server } from "node:http";
import { tmpdir } from "node:os";
import { assert, describe, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { ServerConfig } from "./config.ts";
import { PreviewProxy } from "./preview-proxy.ts";

const config = Layer.succeed(ServerConfig, {
  allowedHosts: [],
  briefing: false,
  cwd: tmpdir(),
  discovery: false,
  host: "127.0.0.1",
  machine: {
    addresses: () => [],
    home: tmpdir(),
    node: process.execPath,
    path: "",
    tmpdir: tmpdir(),
    uid: undefined,
  },
  mcp: false,
  port: 0,
  readyJson: false,
  storage: { mode: "ephemeral" },
  token: "test",
  userDir: tmpdir(),
  version: "test",
  webDist: undefined,
});

/** A server listening on a free loopback port, closed with the test's scope. */
const listening = (server: Server) =>
  Effect.acquireRelease(
    Effect.callback<number>((resume) => {
      server.listen(0, "127.0.0.1", () => {
        const address = server.address();
        resume(
          Effect.succeed(
            typeof address === "object" && address ? address.port : 0
          )
        );
      });
    }),
    () =>
      Effect.callback<void>((resume) => {
        server.closeAllConnections();
        server.close(() => resume(Effect.void));
      })
  );

/** A GET with the `Host` it is given, which `fetch` would not send. */
const get = (port: number, path: string, host = `127.0.0.1:${port}`) =>
  Effect.callback<{ body: string; status: number }>((resume) => {
    request({ headers: { host }, host: "127.0.0.1", path, port }, (res) => {
      let body = "";
      res.on("data", (chunk: Buffer) => {
        body += chunk.toString();
      });
      res.on("end", () =>
        resume(Effect.succeed({ body, status: res.statusCode ?? 0 }))
      );
    }).end();
  });

describe("the preview, forwarded", () => {
  it.effect(
    "sends /preview/ to the preview's server and the rest to the router",
    () =>
      Effect.gen(function* () {
        const proxy = yield* PreviewProxy;
        const preview = yield* listening(
          createServer((req, res) =>
            res.end(`preview ${req.url} ${req.headers.host}`)
          )
        );
        const editor = createServer((_req, res) => res.end("router"));
        proxy.attach(editor);
        const port = yield* listening(editor);

        assert.deepStrictEqual(yield* get(port, "/preview/@vite/client"), {
          body: "the preview is not running",
          status: 503,
        });
        yield* proxy.setTarget(preview);
        assert.deepStrictEqual(yield* get(port, "/preview/@vite/client"), {
          body: `preview /preview/@vite/client 127.0.0.1:${preview}`,
          status: 200,
        });
        assert.deepStrictEqual(yield* get(port, "/api/health"), {
          body: "router",
          status: 200,
        });
        // Another site's name pointed at this machine gets nothing of the preview.
        assert.strictEqual(
          (yield* get(port, "/preview/", "evil.example")).status,
          403
        );
      }).pipe(
        Effect.scoped,
        Effect.provide(PreviewProxy.layer.pipe(Layer.provide(config)))
      )
  );
});
