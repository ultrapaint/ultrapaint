#!/usr/bin/env node
/**
 * A scripted ACP agent for tests, built on the SDK's agent side. The first word of the prompt
 * picks the scenario:
 *
 *   reply       streams two text chunks and ends the turn
 *   tool        a tool call that goes pending, then completed, around a text chunk
 *   permission  asks for permission, then reports the chosen option as text
 *   write       writes `designs/agent.tsx` through `fs/write_text_file`
 *   terminal    runs `echo hi` through `terminal/*` and reports the output
 *   escape      runs a terminal command writing to the path given after the scenario name
 *   blocks      reports how many project briefings came with the prompt
 *   fail        answers the prompt with a JSON-RPC error carrying `data.message`
 *   exit        ends the process in the middle of the turn
 *   wait        streams one chunk and then waits for `session/cancel`
 *
 * `FAKE_AGENT_LOAD=1` advertises `loadSession`; `FAKE_AGENT_AUTH=1` refuses `session/new` until
 * `authenticate` was called.
 */
import { Readable, Writable } from "node:stream";
import {
  agent,
  methods,
  ndJsonStream,
  PROTOCOL_VERSION,
  RequestError,
} from "@agentclientprotocol/sdk";

const cancels = new Map();
let authenticated = process.env.FAKE_AGENT_AUTH !== "1";
let sessions = 0;

const text = (cx, sessionId, value, kind = "agent_message_chunk") =>
  cx.notify(methods.client.session.update, {
    sessionId,
    update: { content: { text: value, type: "text" }, sessionUpdate: kind },
  });

const scenarios = {
  /** Says how much of the prompt was the project briefing, which leads a session's first one. */
  async blocks(cx, sessionId, _cwd, _rest, prompt) {
    const briefings = prompt.filter(
      (block) => block.type === "text" && block.text.startsWith("<ultrapaint>")
    );
    await text(cx, sessionId, `blocks:${briefings.length}`);
  },
  /** Asks the host to run a command that writes outside the repository. */
  async escape(cx, sessionId, _cwd, rest) {
    const { terminalId } = await cx.request(methods.client.terminal.create, {
      args: ["-c", `echo pwned > ${rest}`],
      command: "sh",
      sessionId,
    });
    await cx.request(methods.client.terminal.waitForExit, {
      sessionId,
      terminalId,
    });
    const { output } = await cx.request(methods.client.terminal.output, {
      sessionId,
      terminalId,
    });
    await cx.request(methods.client.terminal.release, {
      sessionId,
      terminalId,
    });
    await text(cx, sessionId, `escape:${output.trim()}`);
  },
  exit() {
    process.exit(7);
  },
  fail() {
    throw new RequestError(-32_603, "Internal error", {
      message: "usage limit reached",
    });
  },
  async permission(cx, sessionId) {
    const response = await cx.request(
      methods.client.session.requestPermission,
      {
        options: [
          { kind: "allow_once", name: "Allow", optionId: "allow" },
          { kind: "reject_once", name: "Reject", optionId: "reject" },
        ],
        sessionId,
        toolCall: { kind: "edit", title: "Edit home", toolCallId: "call_2" },
      }
    );
    const outcome =
      response.outcome.outcome === "selected"
        ? response.outcome.optionId
        : "cancelled";
    await text(cx, sessionId, `permission:${outcome}`);
  },
  async reply(cx, sessionId) {
    await text(cx, sessionId, "Thinking.", "agent_thought_chunk");
    await text(cx, sessionId, "Hello ");
    await text(cx, sessionId, "world");
  },
  async terminal(cx, sessionId) {
    const { terminalId } = await cx.request(methods.client.terminal.create, {
      args: ["hi"],
      command: "echo",
      sessionId,
    });
    await cx.request(methods.client.terminal.waitForExit, {
      sessionId,
      terminalId,
    });
    const { output } = await cx.request(methods.client.terminal.output, {
      sessionId,
      terminalId,
    });
    await cx.request(methods.client.terminal.release, {
      sessionId,
      terminalId,
    });
    await text(cx, sessionId, `terminal:${output.trim()}`);
  },
  async tool(cx, sessionId) {
    await cx.notify(methods.client.session.update, {
      sessionId,
      update: {
        kind: "read",
        locations: [{ path: "designs/home.tsx" }],
        sessionUpdate: "tool_call",
        status: "pending",
        title: "Read home",
        toolCallId: "call_1",
      },
    });
    await cx.notify(methods.client.session.update, {
      sessionId,
      update: {
        content: [
          { content: { text: "file body", type: "text" }, type: "content" },
        ],
        sessionUpdate: "tool_call_update",
        status: "completed",
        toolCallId: "call_1",
      },
    });
    await text(cx, sessionId, "Done reading.");
  },
  async wait(cx, sessionId) {
    await text(cx, sessionId, "waiting");
    await new Promise((resolve) => cancels.set(sessionId, resolve));
    return "cancelled";
  },
  async write(cx, sessionId, cwd) {
    await cx.request(methods.client.fs.writeTextFile, {
      content: "export default function Agent() {\n  return <main />;\n}\n",
      path: `${cwd}/designs/agent.tsx`,
      sessionId,
    });
    await text(cx, sessionId, "written");
  },
};

const cwds = new Map();
const stream = ndJsonStream(
  Writable.toWeb(process.stdout),
  Readable.toWeb(process.stdin)
);

agent({ name: "fake-agent" })
  .onRequest("initialize", () => ({
    agentCapabilities: { loadSession: process.env.FAKE_AGENT_LOAD === "1" },
    authMethods: [{ description: "test", id: "test-auth", name: "Test" }],
    protocolVersion: PROTOCOL_VERSION,
  }))
  .onRequest("authenticate", () => {
    authenticated = true;
    return {};
  })
  .onRequest("session/new", (ctx) => {
    if (!authenticated) {
      throw new RequestError(-32_000, "Authentication required");
    }
    sessions += 1;
    const sessionId = `session_${process.pid}_${sessions}`;
    cwds.set(sessionId, ctx.params.cwd);
    return {
      modes: {
        availableModes: [
          { id: "ask", name: "Ask" },
          { description: "Edits without asking", id: "auto", name: "Auto" },
        ],
        currentModeId: "ask",
      },
      sessionId,
    };
  })
  .onRequest("session/load", async (ctx) => {
    cwds.set(ctx.params.sessionId, ctx.params.cwd);
    // A real agent replays the stored conversation; the host must not show it twice.
    await text(ctx.client, ctx.params.sessionId, "replayed history");
    return {};
  })
  .onRequest("session/set_mode", () => ({}))
  .onRequest("session/prompt", async (ctx) => {
    const { sessionId, prompt } = ctx.params;
    // The project briefing leads the first prompt of a session; the user's own text follows it.
    const first = prompt.find(
      (block) =>
        block.type === "text" && !block.text.startsWith("<ultrapaint>")
    );
    const name = first?.text.split(" ")[0] ?? "reply";
    const scenario = scenarios[name] ?? scenarios.reply;
    const stopReason = await scenario(
      ctx.client,
      sessionId,
      cwds.get(sessionId),
      first?.text.split(" ").slice(1).join(" ") ?? "",
      prompt
    );
    return { stopReason: stopReason ?? "end_turn" };
  })
  .onNotification("session/cancel", (ctx) => {
    cancels.get(ctx.params.sessionId)?.();
    cancels.delete(ctx.params.sessionId);
  })
  .connect(stream);
