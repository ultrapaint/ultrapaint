/**
 * Agent threads. Each thread owns one ACP session with the target repository as working
 * directory. Updates are projected into a transcript that the editor renders, permission
 * requests are routed to the UI, and every filesystem or terminal call the agent makes is
 * confined to the repository.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  type AcpAgentProcess,
  builtInAgents,
  type ContentBlock,
  type RequestPermissionRequest,
  type RequestPermissionResponse,
  type SessionNotification,
  spawnAgent,
  TerminalManager,
} from "@ultrapaint/acp";
import type {
  AgentConfig,
  Checkpoint,
  GitDiff,
  PromptInput,
  Thread,
  ThreadItem,
} from "@ultrapaint/contracts";
import { newId } from "@ultrapaint/shared";
import type { EventBus } from "../events.ts";
import { AppError } from "../router.ts";
import { hashContent, writeAtomic } from "../util.ts";
import type { GitService } from "./git.ts";
import type { RepoPaths } from "./repo.ts";

interface Live {
  process: AcpAgentProcess;
  terminals: TerminalManager;
  pendingPermissions: Map<string, (r: RequestPermissionResponse) => void>;
  remembered: Map<string, string>;
  replaying: boolean;
  currentTurn: {
    snapshot: Map<string, string>;
    agentItemId: string | null;
    thoughtItemId: string | null;
    planItemId: string | null;
  } | null;
}

interface Stored {
  thread: Thread;
  items: ThreadItem[];
}

interface CheckpointFiles {
  checkpoint: Checkpoint;
  files: Record<string, string>;
}

export class ThreadService {
  private threads = new Map<string, Stored>();
  private live = new Map<string, Live>();
  private checkpointStore = new Map<string, CheckpointFiles>();
  private project: { paths: RepoPaths; git: GitService } | null = null;

  constructor(
    readonly home: string,
    readonly events: EventBus,
    readonly log: (level: "info" | "warn" | "error", text: string) => void,
  ) {
    mkdirSync(this.dir, { recursive: true });
    mkdirSync(path.join(home, "agents"), { recursive: true });
    mkdirSync(path.join(home, "checkpoints"), { recursive: true });
    for (const f of readdirSync(this.dir)) {
      if (!f.endsWith(".json")) continue;
      try {
        const stored = JSON.parse(readFileSync(path.join(this.dir, f), "utf8")) as Stored;
        stored.thread = { ...stored.thread, status: "idle" };
        this.threads.set(stored.thread.id, stored);
      } catch (error) {
        log("warn", `ignoring thread file ${f}: ${(error as Error).message}`);
      }
    }
    for (const f of readdirSync(path.join(home, "checkpoints"))) {
      if (!f.endsWith(".json")) continue;
      try {
        const c = JSON.parse(
          readFileSync(path.join(home, "checkpoints", f), "utf8"),
        ) as CheckpointFiles;
        this.checkpointStore.set(c.checkpoint.id, c);
      } catch {
        /* ignore */
      }
    }
  }

  private get dir() {
    return path.join(this.home, "threads");
  }

  attach(project: { paths: RepoPaths; git: GitService }) {
    this.project = project;
  }

  detach() {
    for (const id of Array.from(this.live.keys())) this.stopProcess(id);
    this.project = null;
  }

  async shutdown() {
    this.detach();
  }

  // ---- agents ----
  agents(): AgentConfig[] {
    const custom: AgentConfig[] = [];
    for (const f of readdirSync(path.join(this.home, "agents"))) {
      if (!f.endsWith(".json")) continue;
      try {
        const cfg = JSON.parse(
          readFileSync(path.join(this.home, "agents", f), "utf8"),
        ) as Partial<AgentConfig>;
        if (cfg.id && cfg.name && cfg.command) {
          custom.push({
            id: cfg.id,
            name: cfg.name,
            command: cfg.command,
            args: cfg.args ?? [],
            env: cfg.env ?? {},
            builtIn: false,
            ...(cfg.package ? { package: cfg.package } : {}),
            ...(cfg.authHint ? { authHint: cfg.authHint } : {}),
          });
        }
      } catch {
        /* ignore */
      }
    }
    return [...builtInAgents, ...custom];
  }

  private agent(id: string): AgentConfig {
    const a = this.agents().find((x) => x.id === id);
    if (!a) throw new AppError("not_found", `unknown agent ${id}`);
    return a;
  }

  // ---- persistence ----
  private persist(id: string) {
    const stored = this.threads.get(id);
    if (!stored) return;
    writeAtomic(path.join(this.dir, `${id}.json`), JSON.stringify(stored));
  }

  private update(id: string, patch: Partial<Thread>) {
    const stored = this.threads.get(id);
    if (!stored) return;
    stored.thread = { ...stored.thread, ...patch, updatedAt: Date.now() };
    this.persist(id);
    this.events.emit("agent", { type: "thread", thread: stored.thread });
  }

  private push(id: string, item: ThreadItem) {
    const stored = this.threads.get(id);
    if (!stored) return;
    stored.items.push(item);
    this.persist(id);
    this.events.emit("agent", { type: "item", threadId: id, item });
  }

  private patchItem(id: string, itemId: string, patch: (item: ThreadItem) => ThreadItem) {
    const stored = this.threads.get(id);
    if (!stored) return;
    const idx = stored.items.findIndex((i) => i.id === itemId);
    if (idx < 0) return;
    const next = patch(stored.items[idx] as ThreadItem);
    stored.items[idx] = next;
    this.persist(id);
    this.events.emit("agent", { type: "itemUpdate", threadId: id, item: next });
  }

  // ---- queries ----
  list(): Thread[] {
    return Array.from(this.threads.values())
      .map((s) => s.thread)
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  items(threadId: string): ThreadItem[] {
    return this.threads.get(threadId)?.items ?? [];
  }

  // ---- lifecycle ----
  async create(agentId: string, title?: string): Promise<Thread> {
    const agent = this.agent(agentId);
    const id = newId("thread");
    const now = Date.now();
    const thread: Thread = {
      id,
      agentId,
      title: title ?? `${agent.name} thread`,
      createdAt: now,
      updatedAt: now,
      status: "starting",
    };
    this.threads.set(id, { thread, items: [] });
    this.persist(id);
    this.events.emit("agent", { type: "thread", thread });
    void this.ensureLive(id).catch((error) => {
      this.update(id, { status: "error", error: (error as Error).message });
    });
    return thread;
  }

  private stopProcess(id: string) {
    const live = this.live.get(id);
    if (!live) return;
    live.terminals.releaseAll();
    for (const resolve of live.pendingPermissions.values())
      resolve({ outcome: { outcome: "cancelled" } });
    live.process.close();
    this.live.delete(id);
  }

  private async ensureLive(id: string): Promise<Live> {
    const existing = this.live.get(id);
    if (existing) return existing;
    const stored = this.threads.get(id);
    if (!stored) throw new AppError("not_found", `unknown thread ${id}`);
    const project = this.project;
    if (!project) throw new AppError("not_configured", "no target repository configured");
    const agent = this.agent(stored.thread.agentId);
    this.update(id, { status: "starting", error: undefined });

    const live: Live = {
      process: null as unknown as AcpAgentProcess,
      terminals: new TerminalManager(),
      pendingPermissions: new Map(),
      remembered: new Map(),
      replaying: false,
      currentTurn: null,
    };
    live.process = spawnAgent(agent, {
      cwd: project.paths.root,
      handlers: {
        onUpdate: (n) => this.onUpdate(id, live, n),
        onPermission: (req) => this.onPermission(id, live, req),
        readTextFile: async (req) => {
          const abs = project.paths.resolve(req.path);
          const content = readFileSync(abs, "utf8");
          if (req.line || req.limit) {
            const lines = content.split("\n");
            const start = Math.max(0, (req.line ?? 1) - 1);
            return {
              content: lines.slice(start, req.limit ? start + req.limit : undefined).join("\n"),
            };
          }
          return { content };
        },
        writeTextFile: async (req) => {
          const abs = project.paths.resolve(req.path);
          writeAtomic(abs, req.content);
          this.events.emit("file.changed", {
            file: project.paths.relative(abs),
            hash: hashContent(req.content),
          });
        },
        terminal: {
          create: async (req) => {
            const cwd = req.cwd ? project.paths.resolve(req.cwd) : project.paths.root;
            const env: Record<string, string> = {};
            for (const e of req.env ?? []) env[e.name] = e.value;
            return {
              terminalId: live.terminals.create(
                req.command,
                req.args ?? [],
                env,
                cwd,
                req.outputByteLimit,
              ),
            };
          },
          output: async (req) => live.terminals.output(req.terminalId),
          waitForExit: async (req) => live.terminals.waitForExit(req.terminalId),
          kill: async (req) => live.terminals.kill(req.terminalId),
          release: async (req) => live.terminals.release(req.terminalId),
        },
        onExit: (code, signal) => {
          if (this.live.get(id) === live) {
            this.live.delete(id);
            const s = this.threads.get(id)?.thread.status;
            if (s === "running" || s === "starting")
              this.update(id, { status: "error", error: `agent exited (${signal ?? code})` });
            else this.update(id, { status: "idle" });
          }
        },
        onLog: (level, text) => this.log(level, `[${agent.name}] ${text}`),
      },
    });
    this.live.set(id, live);

    const init = await live.process.initialize();
    const authMethods = init.authMethods ?? [];
    let session: { sessionId: string; modes?: unknown; configOptions?: unknown } | null = null;
    const start = async () => {
      if (stored.thread.sessionId && init.agentCapabilities?.loadSession) {
        live.replaying = true;
        try {
          const loaded = await live.process.loadSession(
            stored.thread.sessionId,
            project.paths.root,
          );
          session = { sessionId: stored.thread.sessionId, ...(loaded ?? {}) };
        } catch (error) {
          this.log("warn", `session load failed, starting fresh: ${(error as Error).message}`);
        } finally {
          live.replaying = false;
        }
      }
      if (!session) session = await live.process.newSession(project.paths.root);
    };
    try {
      await start();
    } catch (error) {
      // Some agents need authentication before a session can be created.
      const first = authMethods[0];
      if (first && /auth/i.test((error as Error).message)) {
        await live.process.authenticate(first.id);
        await start();
      } else throw error;
    }
    const s = session as unknown as {
      sessionId: string;
      modes?: {
        currentModeId: string;
        availableModes: { id: string; name: string; description?: string | null }[];
      } | null;
      configOptions?: unknown[] | null;
    };
    this.update(id, {
      status: "idle",
      sessionId: s.sessionId,
      currentModeId: s.modes?.currentModeId,
      modes: s.modes?.availableModes.map((m) => ({
        id: m.id,
        name: m.name,
        ...(m.description ? { description: m.description } : {}),
      })),
      configOptions: this.mapConfigOptions(s.configOptions),
    });
    return live;
  }

  private mapConfigOptions(options: unknown): Thread["configOptions"] {
    if (!Array.isArray(options)) return undefined;
    return options.map((o) => {
      const opt = o as {
        id: string;
        name: string;
        category?: string | null;
        type: string;
        currentValue: unknown;
        options?: { value: string; name: string; description?: string | null }[];
      };
      return {
        id: opt.id,
        name: opt.name,
        ...(opt.category ? { category: opt.category } : {}),
        currentValue: String(opt.currentValue),
        options:
          opt.type === "boolean"
            ? [
                { value: "true", name: "On" },
                { value: "false", name: "Off" },
              ]
            : (opt.options ?? []).map((x) => ({
                value: x.value,
                name: x.name,
                ...(x.description ? { description: x.description } : {}),
              })),
      };
    });
  }

  // ---- updates ----
  private onUpdate(id: string, live: Live, n: SessionNotification) {
    if (live.replaying) return;
    const u = n.update;
    const now = Date.now();
    const turn = live.currentTurn;
    switch (u.sessionUpdate) {
      case "agent_message_chunk": {
        const text = u.content.type === "text" ? u.content.text : `[${u.content.type}]`;
        if (turn?.agentItemId) {
          this.patchItem(id, turn.agentItemId, (i) =>
            i.kind === "agent" ? { ...i, text: i.text + text } : i,
          );
        } else {
          const item: ThreadItem = { id: newId("item"), kind: "agent", text, at: now };
          if (turn) {
            turn.agentItemId = item.id;
            turn.thoughtItemId = null;
          }
          this.push(id, item);
        }
        break;
      }
      case "agent_thought_chunk": {
        const text = u.content.type === "text" ? u.content.text : "";
        if (turn?.thoughtItemId) {
          this.patchItem(id, turn.thoughtItemId, (i) =>
            i.kind === "thought" ? { ...i, text: i.text + text } : i,
          );
        } else {
          const item: ThreadItem = { id: newId("item"), kind: "thought", text, at: now };
          if (turn) {
            turn.thoughtItemId = item.id;
            turn.agentItemId = null;
          }
          this.push(id, item);
        }
        break;
      }
      case "tool_call": {
        if (turn) {
          turn.agentItemId = null;
          turn.thoughtItemId = null;
        }
        this.push(id, {
          id: `tool_${u.toolCallId}`,
          kind: "tool",
          toolCallId: u.toolCallId,
          title: u.title,
          ...(u.kind ? { toolKind: u.kind } : {}),
          status: u.status ?? "pending",
          content: (u.content ?? []).map(toolContentText),
          locations: (u.locations ?? []).map((l) => l.path),
          at: now,
        });
        break;
      }
      case "tool_call_update": {
        const itemId = `tool_${u.toolCallId}`;
        const exists = this.threads.get(id)?.items.some((i) => i.id === itemId);
        if (!exists) {
          this.push(id, {
            id: itemId,
            kind: "tool",
            toolCallId: u.toolCallId,
            title: u.title ?? "Tool call",
            ...(u.kind ? { toolKind: u.kind } : {}),
            status: u.status ?? "in_progress",
            content: (u.content ?? []).map(toolContentText),
            locations: (u.locations ?? []).map((l) => l.path),
            at: now,
          });
          break;
        }
        this.patchItem(id, itemId, (i) =>
          i.kind === "tool"
            ? {
                ...i,
                title: u.title ?? i.title,
                status: u.status ?? i.status,
                content: u.content ? u.content.map(toolContentText) : i.content,
                locations: u.locations ? u.locations.map((l) => l.path) : i.locations,
              }
            : i,
        );
        break;
      }
      case "plan":
      case "plan_update": {
        const entries =
          "entries" in u && Array.isArray(u.entries)
            ? u.entries.map((e) => ({ content: e.content, status: e.status, priority: e.priority }))
            : [];
        if (turn?.planItemId) {
          this.patchItem(id, turn.planItemId, (i) => (i.kind === "plan" ? { ...i, entries } : i));
        } else {
          const item: ThreadItem = { id: newId("item"), kind: "plan", entries, at: now };
          if (turn) turn.planItemId = item.id;
          this.push(id, item);
        }
        break;
      }
      case "current_mode_update":
        this.update(id, { currentModeId: u.currentModeId });
        break;
      case "config_option_update":
        this.update(id, { configOptions: this.mapConfigOptions(u.configOptions) });
        break;
      case "session_info_update": {
        const info = u as { title?: string | null };
        if (info.title) this.update(id, { title: info.title });
        break;
      }
      default:
        break;
    }
  }

  private async onPermission(
    id: string,
    live: Live,
    req: RequestPermissionRequest,
  ): Promise<RequestPermissionResponse> {
    const key = req.toolCall.kind ?? req.toolCall.title ?? "tool";
    const remembered = live.remembered.get(key);
    if (remembered && req.options.some((o) => o.optionId === remembered)) {
      return { outcome: { outcome: "selected", optionId: remembered } };
    }
    const requestId = newId("perm");
    const detail = [
      ...(req.toolCall.locations ?? []).map((l) => l.path),
      ...(req.toolCall.rawInput ? [JSON.stringify(req.toolCall.rawInput).slice(0, 500)] : []),
    ].join("\n");
    this.push(id, {
      id: requestId,
      kind: "permission",
      requestId,
      ...(req.toolCall.toolCallId ? { toolCallId: req.toolCall.toolCallId } : {}),
      title: req.toolCall.title ?? "Permission request",
      ...(detail ? { detail } : {}),
      options: req.options.map((o) => ({ optionId: o.optionId, name: o.name, kind: o.kind })),
      decision: null,
      at: Date.now(),
    });
    return new Promise((resolve) => {
      live.pendingPermissions.set(requestId, (r) => {
        live.pendingPermissions.delete(requestId);
        if (r.outcome.outcome === "selected") {
          const optionId = r.outcome.optionId;
          this.patchItem(id, requestId, (i) =>
            i.kind === "permission" ? { ...i, decision: optionId } : i,
          );
        } else {
          this.patchItem(id, requestId, (i) =>
            i.kind === "permission" ? { ...i, decision: "cancelled" } : i,
          );
        }
        resolve(r);
      });
    });
  }

  async resolvePermission(
    threadId: string,
    requestId: string,
    optionId: string,
    remember: boolean,
  ) {
    const live = this.live.get(threadId);
    const resolve = live?.pendingPermissions.get(requestId);
    if (!live || !resolve)
      throw new AppError("not_found", "permission request is no longer pending");
    if (remember) {
      const item = this.threads.get(threadId)?.items.find((i) => i.id === requestId);
      if (item?.kind === "permission") live.remembered.set(item.title, optionId);
    }
    resolve({ outcome: { outcome: "selected", optionId } });
  }

  // ---- prompting ----
  async prompt(input: PromptInput) {
    const stored = this.threads.get(input.threadId);
    if (!stored) throw new AppError("not_found", `unknown thread ${input.threadId}`);
    if (stored.thread.status === "running")
      throw new AppError("conflict", "the agent is still working on the previous prompt");
    const project = this.project;
    if (!project) throw new AppError("not_configured", "no target repository configured");
    const live = await this.ensureLive(input.threadId);
    const sessionId = this.threads.get(input.threadId)?.thread.sessionId;
    if (!sessionId) throw new AppError("agent_error", "no session");

    const blocks: ContentBlock[] = [{ type: "text", text: input.text }];
    const attachmentLabels: string[] = [];
    for (const a of input.attachments) {
      if (a.kind === "file") {
        const abs = project.paths.resolve(a.path);
        const text = existsSync(abs) ? readFileSync(abs, "utf8") : "";
        blocks.push({
          type: "resource",
          resource: { uri: `file://${abs}`, mimeType: "text/plain", text },
        });
        attachmentLabels.push(a.path);
      } else if (a.kind === "selection") {
        const abs = project.paths.resolve(a.file);
        blocks.push({
          type: "text",
          text: `The user has selected the <${a.name}> element at ${a.file}:${a.line}:${a.col} (line ${a.line}, column ${a.col}) on the design canvas. Edits should target this element unless told otherwise.`,
        });
        blocks.push({ type: "resource_link", uri: `file://${abs}`, name: a.file });
        attachmentLabels.push(`${a.name} @ ${a.file}:${a.line}`);
      } else if (a.kind === "image") {
        const m = /^data:([^;]+);base64,(.*)$/s.exec(a.dataUrl);
        if (m) blocks.push({ type: "image", mimeType: m[1] as string, data: m[2] as string });
        attachmentLabels.push(a.name);
      }
    }
    this.push(input.threadId, {
      id: newId("item"),
      kind: "user",
      text: input.text,
      at: Date.now(),
      attachments: attachmentLabels,
    });
    const snapshot = await project.git.snapshot().catch(() => new Map<string, string>());
    live.currentTurn = { snapshot, agentItemId: null, thoughtItemId: null, planItemId: null };
    await this.checkpoint(input.threadId, `Before: ${input.text.slice(0, 60)}`);
    this.update(input.threadId, { status: "running" });
    live.process
      .prompt(sessionId, blocks)
      .then(async (res) => {
        const changedFiles = await project.git.changedSince(snapshot).catch(() => []);
        this.push(input.threadId, {
          id: newId("item"),
          kind: "turn_end",
          stopReason: res.stopReason,
          changedFiles,
          at: Date.now(),
        });
        this.update(input.threadId, { status: "idle" });
      })
      .catch((error: Error & { data?: { message?: string } }) => {
        // ACP errors carry the agent's own explanation in `data`; surface it, not "Internal error".
        const detail = typeof error.data?.message === "string" ? error.data.message : error.message;
        this.push(input.threadId, {
          id: newId("item"),
          kind: "status",
          text: `Turn failed: ${detail}`,
          at: Date.now(),
        });
        this.update(input.threadId, { status: "error", error: detail });
      })
      .finally(() => {
        live.currentTurn = null;
      });
  }

  async cancel(threadId: string) {
    const live = this.live.get(threadId);
    const sessionId = this.threads.get(threadId)?.thread.sessionId;
    if (!live || !sessionId) return;
    this.update(threadId, { status: "cancelling" });
    await live.process.cancel(sessionId);
  }

  async delete(threadId: string) {
    this.stopProcess(threadId);
    this.threads.delete(threadId);
    rmSync(path.join(this.dir, `${threadId}.json`), { force: true });
    this.events.emit("agent", { type: "removed", threadId });
  }

  async setMode(threadId: string, modeId: string) {
    const live = await this.ensureLive(threadId);
    const sessionId = this.threads.get(threadId)?.thread.sessionId as string;
    await live.process.setMode(sessionId, modeId);
    this.update(threadId, { currentModeId: modeId });
  }

  async setConfigOption(threadId: string, optionId: string, value: string) {
    const live = await this.ensureLive(threadId);
    const sessionId = this.threads.get(threadId)?.thread.sessionId as string;
    const v = value === "true" ? true : value === "false" ? false : value;
    const res = (await live.process.setConfigOption(sessionId, optionId, v)) as
      | { configOptions?: unknown }
      | undefined;
    const thread = this.threads.get(threadId)?.thread;
    const mapped = this.mapConfigOptions(res?.configOptions);
    this.update(threadId, {
      configOptions:
        mapped ??
        thread?.configOptions?.map((o) => (o.id === optionId ? { ...o, currentValue: value } : o)),
    });
  }

  // ---- checkpoints: snapshots of the designs directory before each agent turn ----
  private designFiles(): Record<string, string> {
    const project = this.project;
    if (!project) return {};
    const out: Record<string, string> = {};
    const walk = (dir: string) => {
      if (!existsSync(dir)) return;
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        if (e.isDirectory()) {
          if (e.name === "node_modules" || e.name.startsWith(".")) continue;
          walk(path.join(dir, e.name));
        } else if (/\.(tsx?|json|css|md)$/.test(e.name)) {
          const abs = path.join(dir, e.name);
          out[project.paths.relative(abs)] = readFileSync(abs, "utf8");
        }
      }
    };
    walk(project.paths.designsDir);
    return out;
  }

  private async checkpoint(threadId: string, label: string) {
    const files = this.designFiles();
    const checkpoint: Checkpoint = {
      id: newId("cp"),
      threadId,
      label,
      at: Date.now(),
      files: Object.keys(files),
    };
    const record = { checkpoint, files };
    this.checkpointStore.set(checkpoint.id, record);
    writeFileSync(
      path.join(this.home, "checkpoints", `${checkpoint.id}.json`),
      JSON.stringify(record),
    );
    // Keep the last 30.
    const all = Array.from(this.checkpointStore.values()).sort(
      (a, b) => a.checkpoint.at - b.checkpoint.at,
    );
    while (all.length > 30) {
      const old = all.shift() as CheckpointFiles;
      this.checkpointStore.delete(old.checkpoint.id);
      rmSync(path.join(this.home, "checkpoints", `${old.checkpoint.id}.json`), { force: true });
    }
  }

  checkpoints(): Checkpoint[] {
    return Array.from(this.checkpointStore.values())
      .map((c) => c.checkpoint)
      .sort((a, b) => b.at - a.at);
  }

  async checkpointDiff(id: string): Promise<GitDiff[]> {
    const record = this.checkpointStore.get(id);
    const project = this.project;
    if (!record || !project) throw new AppError("not_found", "unknown checkpoint");
    const current = this.designFiles();
    const out: GitDiff[] = [];
    const all = new Set([...Object.keys(record.files), ...Object.keys(current)]);
    for (const file of all) {
      const before = record.files[file];
      const after = current[file];
      if (before === after) continue;
      out.push({ path: file, diff: simpleDiff(file, before ?? "", after ?? "") });
    }
    return out;
  }

  async revertCheckpoint(id: string) {
    const record = this.checkpointStore.get(id);
    const project = this.project;
    if (!record || !project) throw new AppError("not_found", "unknown checkpoint");
    const current = this.designFiles();
    for (const [file, content] of Object.entries(record.files)) {
      if (current[file] !== content) {
        writeAtomic(project.paths.resolve(file), content);
        this.events.emit("file.changed", { file, hash: hashContent(content) });
      }
    }
    for (const file of Object.keys(current)) {
      if (!(file in record.files)) rmSync(project.paths.resolve(file), { force: true });
    }
  }
}

const toolContentText = (c: { type: string; [k: string]: unknown }): string => {
  if (c.type === "content") {
    const content = c.content as { type: string; text?: string } | undefined;
    return content?.type === "text" ? (content.text ?? "") : `[${content?.type ?? "content"}]`;
  }
  if (c.type === "diff") return `diff ${String(c.path ?? "")}`;
  if (c.type === "terminal") return `terminal ${String(c.terminalId ?? "")}`;
  return `[${c.type}]`;
};

/** Line-based unified-ish diff good enough for review; git is not involved for snapshots. */
const simpleDiff = (file: string, before: string, after: string): string => {
  const a = before.split("\n");
  const b = after.split("\n");
  const out: string[] = [`--- a/${file}`, `+++ b/${file}`];
  // LCS on lines.
  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i -= 1) {
    const row = dp[i] as number[];
    const next = dp[i + 1] as number[];
    for (let j = m - 1; j >= 0; j -= 1) {
      row[j] = a[i] === b[j] ? (next[j + 1] ?? 0) + 1 : Math.max(next[j] ?? 0, row[j + 1] ?? 0);
    }
  }
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) {
      out.push(` ${a[i]}`);
      i += 1;
      j += 1;
    } else if (j < m && (i >= n || (dp[i]?.[j + 1] ?? 0) >= (dp[i + 1]?.[j] ?? 0))) {
      out.push(`+${b[j]}`);
      j += 1;
    } else {
      out.push(`-${a[i]}`);
      i += 1;
    }
  }
  return out.join("\n");
};
