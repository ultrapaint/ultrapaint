import { type ChildProcess, spawn } from "node:child_process";

interface TerminalRecord {
  child: ChildProcess;
  exit: Promise<{ exitCode: number | null; signal: string | null }>;
  exited: { exitCode: number | null; signal: string | null } | null;
  limit: number;
  output: string;
  truncated: boolean;
}

/**
 * Terminals the agent asks the client to run. Commands run with the given cwd (already
 * validated by the caller) and their output is buffered up to a byte limit.
 */
export class TerminalManager {
  private readonly terminals = new Map<string, TerminalRecord>();
  private nextId = 1;

  create(
    command: string,
    args: string[],
    env: Record<string, string>,
    cwd: string,
    outputByteLimit?: number | null
  ): string {
    const id = `term_${this.nextId}`;
    this.nextId += 1;
    const child = spawn(command, args, {
      cwd,
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const record: TerminalRecord = {
      child,
      exit: new Promise((resolve) => {
        child.on("exit", (code, signal) => {
          const r = { exitCode: code, signal: signal as string | null };
          record.exited = r;
          resolve(r);
        });
        child.on("error", () => {
          const r = { exitCode: -1, signal: null };
          record.exited = r;
          resolve(r);
        });
      }),
      exited: null,
      limit: outputByteLimit ?? 1024 * 1024,
      output: "",
      truncated: false,
    };
    const append = (d: Buffer) => {
      record.output += d.toString();
      if (record.output.length > record.limit) {
        record.output = record.output.slice(
          record.output.length - record.limit
        );
        record.truncated = true;
      }
    };
    child.stdout?.on("data", append);
    child.stderr?.on("data", append);
    this.terminals.set(id, record);
    return id;
  }

  output(id: string) {
    const t = this.terminals.get(id);
    if (!t) {
      throw new Error(`unknown terminal ${id}`);
    }
    return {
      exitStatus: t.exited ?? null,
      output: t.output,
      truncated: t.truncated,
    };
  }

  waitForExit(id: string) {
    const t = this.terminals.get(id);
    if (!t) {
      throw new Error(`unknown terminal ${id}`);
    }
    return t.exit;
  }

  kill(id: string) {
    this.terminals.get(id)?.child.kill("SIGTERM");
  }

  release(id: string) {
    const t = this.terminals.get(id);
    if (t && t.exited === null) {
      t.child.kill("SIGKILL");
    }
    this.terminals.delete(id);
  }

  releaseAll() {
    for (const id of Array.from(this.terminals.keys())) {
      this.release(id);
    }
  }
}
