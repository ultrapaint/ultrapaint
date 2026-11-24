#!/usr/bin/env node
/**
 * An ACP agent that works the way a real one does, at its rate, for `pnpm bench:chats`. A prompt
 * `load <seconds> <[canvas:]route#node | -> <history>` keeps it busy that long, in cycles: a thought streamed, three tool calls
 * (announced, under way, then done with what they read), and an answer streamed, each chunk a few
 * characters, `CHUNK_MS` apart. Given a node, it also changes its text through the editor's MCP
 * server once a cycle, as a design agent does. It first says `history` tool calls at once, done,
 * as the transcript of a chat that has been working for a while. It says nothing of what it is: a session is a session.
 */
import { Readable, Writable } from "node:stream";
import {
  agent,
  methods,
  ndJsonStream,
  PROTOCOL_VERSION,
} from "@agentclientprotocol/sdk";

const CHUNK_MS = Number(process.env.LOAD_CHUNK_MS ?? 30);
const WORDS =
  "the header holds the title and the actions while the list below it scrolls on its own and each row keeps one baseline for its name and its value ".split(
    " "
  );
const READ =
  "A page is a few large regions on a grid, and it holds at every width the product supports. Decide the regions first, then fill them.\n".repeat(
    12
  );

const SPACES_RE = /\s+/;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const cancelled = new Set();
const mcpServers = new Map();
let calls = 0;

const update = (cx, sessionId, value) =>
  cx.notify(methods.client.session.update, { sessionId, update: value });

const stream = async (cx, sessionId, kind, chunks) => {
  for (let i = 0; i < chunks && !cancelled.has(sessionId); i += 1) {
    const word = WORDS[(i * 7) % WORDS.length];
    // biome-ignore lint/performance/noAwaitInLoops: a stream, one chunk after the other.
    await update(cx, sessionId, {
      content: { text: `${word} `, type: "text" },
      sessionUpdate: kind,
    });
    await sleep(CHUNK_MS);
  }
};

const tool = async (cx, sessionId, wait = CHUNK_MS) => {
  calls += 1;
  const toolCallId = `call_${process.pid}_${calls}`;
  await update(cx, sessionId, {
    kind: "read",
    rawInput: { file_path: "/repo/skills/layout.md" },
    sessionUpdate: "tool_call",
    status: "pending",
    title: "Read skills/layout.md",
    toolCallId,
  });
  await sleep(wait * 3);
  await update(cx, sessionId, {
    sessionUpdate: "tool_call_update",
    status: "in_progress",
    toolCallId,
  });
  await sleep(wait * 6);
  await update(cx, sessionId, {
    content: [{ content: { text: READ, type: "text" }, type: "content" }],
    sessionUpdate: "tool_call_update",
    status: "completed",
    toolCallId,
  });
};

/** The editor's MCP server, called as an agent calls it: JSON-RPC over http, one session. */
const mcpClient = (server) => {
  let session;
  const headers = () => ({
    accept: "application/json, text/event-stream",
    "content-type": "application/json",
    ...Object.fromEntries(server.headers.map((h) => [h.name, h.value])),
    ...(session
      ? { "mcp-protocol-version": "2025-06-18", "mcp-session-id": session }
      : {}),
  });
  let id = 0;
  const rpc = async (method, params, notify = false) => {
    const message = { jsonrpc: "2.0", method, params };
    if (!notify) {
      id += 1;
      message.id = id;
    }
    const response = await fetch(server.url, {
      body: JSON.stringify(message),
      headers: headers(),
      method: "POST",
    });
    session ??= response.headers.get("mcp-session-id") ?? undefined;
    const body = await response.text();
    // Answered as server-sent events, or as plain JSON; a notification with nothing.
    const line = body.split("\n").find((l) => l.startsWith("data: "));
    if (line) {
      return JSON.parse(line.slice("data: ".length));
    }
    return body ? JSON.parse(body) : null;
  };
  const ready = rpc("initialize", {
    capabilities: {},
    clientInfo: { name: "load-agent", version: "1" },
    protocolVersion: "2025-06-18",
  }).then(() => rpc("notifications/initialized", {}, true));
  return {
    call: async (name, args) => {
      await ready;
      return rpc("tools/call", { arguments: args, name });
    },
  };
};

const mcpOf = new Map();

/** Changes a text of the page the prompt names: the same node, a new word each time. */
const edit = async (cx, sessionId, target, n) => {
  const [server] = mcpServers.get(sessionId) ?? [];
  if (!(server && target)) {
    return;
  }
  const client = mcpOf.get(sessionId) ?? mcpClient(server);
  mcpOf.set(sessionId, client);
  // `route#node`, or `canvas:route#node` in a project with several canvases.
  const [where, nodeId] = target.split("#");
  const [canvas, route] = where.includes(":")
    ? where.split(":")
    : [undefined, where];
  const toolCallId = `call_${process.pid}_mcp_${n}`;
  await update(cx, sessionId, {
    kind: "other",
    rawInput: { route },
    sessionUpdate: "tool_call",
    status: "in_progress",
    title: "mcp__ultrapaint__apply_operations",
    toolCallId,
  });
  const result = await client
    .call("apply_operations", {
      ...(canvas ? { canvas } : {}),
      ops: [
        {
          id: nodeId,
          op: "update",
          set: { text: `${WORDS[n % WORDS.length]} ${n}` },
        },
      ],
      route,
    })
    .catch((error) => ({ error: String(error) }));
  await update(cx, sessionId, {
    content: [
      {
        content: { text: JSON.stringify(result).slice(0, 400), type: "text" },
        type: "content",
      },
    ],
    sessionUpdate: "tool_call_update",
    status: "completed",
    toolCallId,
  });
};

const work = async (cx, sessionId, seconds, target, history) => {
  for (let i = 0; i < history; i += 1) {
    // biome-ignore lint/performance/noAwaitInLoops: a transcript, one call after the other.
    await tool(cx, sessionId, 0);
  }
  const until = Date.now() + seconds * 1000;
  let n = 0;
  while (Date.now() < until && !cancelled.has(sessionId)) {
    n += 1;
    // biome-ignore lint/performance/noAwaitInLoops: a turn, one step after the other.
    await stream(cx, sessionId, "agent_thought_chunk", 30);
    for (let i = 0; i < 3 && !cancelled.has(sessionId); i += 1) {
      // biome-ignore lint/performance/noAwaitInLoops: one tool call after the other.
      await tool(cx, sessionId);
    }
    await edit(cx, sessionId, target, n);
    await stream(cx, sessionId, "agent_message_chunk", 60);
  }
};

agent({ name: "load-agent" })
  .onRequest("initialize", () => ({
    agentCapabilities: {
      loadSession: false,
      mcpCapabilities: { http: true },
      promptCapabilities: { embeddedContext: true, image: true },
    },
    authMethods: [],
    protocolVersion: PROTOCOL_VERSION,
  }))
  .onRequest("session/new", (ctx) => {
    const sessionId = `load_${process.pid}_${Date.now()}`;
    mcpServers.set(sessionId, ctx.params.mcpServers ?? []);
    return { sessionId };
  })
  .onRequest("session/set_mode", () => ({}))
  .onRequest("session/set_config_option", () => ({ configOptions: [] }))
  .onRequest("session/prompt", async (ctx) => {
    const { prompt, sessionId } = ctx.params;
    cancelled.delete(sessionId);
    const own = prompt.findLast(
      (b) => b.type === "text" && !b.text.startsWith("<ultrapaint")
    );
    const [, seconds, target, history] = (own?.text ?? "load 10")
      .trim()
      .split(SPACES_RE);
    await work(
      ctx.client,
      sessionId,
      Number(seconds) || 10,
      target === "-" ? undefined : target,
      Number(history) || 0
    );
    return {
      stopReason: cancelled.has(sessionId) ? "cancelled" : "end_turn",
    };
  })
  .onNotification("session/cancel", (ctx) => {
    cancelled.add(ctx.params.sessionId);
  })
  .connect(
    ndJsonStream(Writable.toWeb(process.stdout), Readable.toWeb(process.stdin))
  );
