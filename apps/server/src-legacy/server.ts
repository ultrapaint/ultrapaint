import { existsSync, readFileSync, statSync } from "node:fs";
import { createServer as createHttpServer } from "node:http";
import path from "node:path";
import { WebSocketServer } from "ws";
import { createContext } from "./context.ts";
import { registerHandlers } from "./handlers.ts";
import { attachWebSocket } from "./ws/socket.ts";

export interface ServerOptions {
  home?: string;
  port: number;
  webDist?: string;
}

const MIME: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
};

export const startServer = async (options: ServerOptions) => {
  const ctx = await createContext({ home: options.home });
  const router = registerHandlers(ctx);

  const http = createHttpServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (url.pathname === "/api/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, version: ctx.version }));
      return;
    }
    if (options.webDist) {
      let file = path.join(options.webDist, url.pathname);
      if (!existsSync(file) || statSync(file).isDirectory()) {
        file = path.join(options.webDist, "index.html");
      }
      const ext = path.extname(file);
      res.writeHead(200, {
        "content-type": MIME[ext] ?? "application/octet-stream",
      });
      res.end(readFileSync(file));
      return;
    }
    res.writeHead(404);
    res.end("not found");
  });

  const wss = new WebSocketServer({ path: "/ws", server: http });
  attachWebSocket(wss, router, ctx);

  await new Promise<void>((resolve) =>
    http.listen(options.port, "127.0.0.1", resolve)
  );
  ctx.log("server", "info", `listening on http://127.0.0.1:${options.port}`);

  // Bring the project up if settings already exist.
  ctx.project.boot();

  return {
    close: async () => {
      await ctx.shutdown();
      wss.close();
      http.close();
    },
    port: options.port,
  };
};
