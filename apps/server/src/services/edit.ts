import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { EditOp, EditResult, SourceLocation, UndoState } from "@ultrapaint/contracts";
import { AppError } from "../router.ts";
import { hashContent, KeyedQueue, writeAtomic } from "../util.ts";
import type { RepoPaths } from "./repo.ts";
import {
  applyDelete,
  applyDuplicate,
  applyInsert,
  applyMove,
  applySetAttribute,
  applySetClasses,
  applySetText,
  collectElements,
  type EditOutcome,
  locationOf,
  parseTsx,
} from "./source.ts";

interface JournalEntry {
  id: number;
  file: string;
  before: string;
  after: string;
  label: string;
  trackIndex: number | null;
}

const runShell = (
  cwd: string,
  command: string,
  timeoutMs = 15000,
): Promise<{ ok: boolean; output: string }> =>
  new Promise((resolve) => {
    const child = spawn("/bin/sh", ["-c", command], { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout?.on("data", (d) => {
      output += String(d);
    });
    child.stderr?.on("data", (d) => {
      output += String(d);
    });
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.on("exit", (code) => {
      clearTimeout(timer);
      resolve({ ok: code === 0, output });
    });
  });

/**
 * Applies edits to screen files: one writer per file, atomic writes, the target repo's
 * formatter, and an undo journal that is invalidated by external changes.
 */
export class EditService {
  private queue = new KeyedQueue();
  private journal: JournalEntry[] = [];
  private cursor = 0;
  private nextId = 1;
  private invalidated: string | undefined;

  constructor(
    private readonly paths: RepoPaths,
    private readonly formatCommand: string | undefined,
    private readonly onState: (state: UndoState) => void,
    private readonly onFileWritten: (file: string, hash: string) => void,
  ) {}

  private detectFormatter(): string | undefined {
    if (this.formatCommand) return this.formatCommand;
    if (existsSync(path.join(this.paths.root, "node_modules", ".bin", "biome"))) {
      // A full `biome check` can take seconds with type-aware rules; format plus the two
      // rules that matter for generated JSX keeps the round trip well under a second.
      return "node_modules/.bin/biome lint --write --unsafe --only=nursery/useSortedClasses --only=correctness/noUnusedImports {file}; node_modules/.bin/biome format --write {file}";
    }
    if (existsSync(path.join(this.paths.root, "node_modules", ".bin", "prettier"))) {
      return "node_modules/.bin/prettier --write {file}";
    }
    return undefined;
  }

  read(rel: string): { content: string; hash: string; abs: string } {
    const abs = this.paths.resolve(rel);
    if (!existsSync(abs)) throw new AppError("not_found", `file not found: ${rel}`);
    const content = readFileSync(abs, "utf8");
    return { content, hash: hashContent(content), abs };
  }

  state(): UndoState {
    const undo = this.journal[this.cursor - 1];
    const redo = this.journal[this.cursor];
    return {
      canUndo: !!undo,
      canRedo: !!redo,
      undoLabel: undo?.label,
      redoLabel: redo?.label,
      invalidated: this.invalidated,
    };
  }

  private emitState() {
    this.onState(this.state());
  }

  private fileOf(op: EditOp): string {
    return op.kind === "insert" ? op.into.file : op.target.file;
  }

  private labelOf(op: EditOp): string {
    switch (op.kind) {
      case "setClasses":
        return `Change classes (${[...op.add, ...op.remove.map((r) => `-${r}`)].join(" ")})`;
      case "setAttribute":
        return op.value === null ? `Remove ${op.name}` : `Set ${op.name}`;
      case "setText":
        return "Edit text";
      case "delete":
        return "Delete element";
      case "duplicate":
        return "Duplicate element";
      case "move":
        return "Move element";
      case "insert":
        return "Insert element";
    }
  }

  private run(op: EditOp, code: string): EditOutcome {
    switch (op.kind) {
      case "setClasses":
        return applySetClasses(code, op.target, op.add, op.remove);
      case "setAttribute":
        return applySetAttribute(code, op.target, op.name, op.value);
      case "setText":
        return applySetText(code, op.target, op.text);
      case "delete":
        return applyDelete(code, op.target);
      case "duplicate":
        return applyDuplicate(code, op.target);
      case "move":
        return applyMove(code, op.target, op.into, op.index);
      case "insert":
        return applyInsert(code, op.into, op.index, op.jsx, op.imports);
    }
  }

  async apply(op: EditOp, expectedHash?: string): Promise<EditResult> {
    const rel = this.fileOf(op);
    if (!this.paths.isEditable(rel))
      throw new AppError("forbidden_path", `${rel} is outside the designs directory`);
    return this.queue.run(rel, async () => {
      const { content, hash, abs } = this.read(rel);
      if (expectedHash && expectedHash !== hash) {
        throw new AppError("stale", "the file changed since you last saw it; reloading");
      }
      const outcome = this.run(op, content);
      if (outcome.code === content) {
        return {
          file: rel,
          hash,
          changed: false,
          location: null,
          formatted: false,
          warnings: outcome.warnings,
        };
      }
      const written = await this.write(
        abs,
        rel,
        outcome.code,
        outcome.trackIndex,
        outcome.warnings,
      );
      // Journal: drop redo entries beyond the cursor.
      this.journal = this.journal.slice(0, this.cursor);
      this.journal.push({
        id: this.nextId++,
        file: rel,
        before: content,
        after: written.content,
        label: this.labelOf(op),
        trackIndex: outcome.trackIndex,
      });
      if (this.journal.length > 200) this.journal.shift();
      this.cursor = this.journal.length;
      this.invalidated = undefined;
      this.emitState();
      return written.result;
    });
  }

  private async write(
    abs: string,
    rel: string,
    code: string,
    trackIndex: number | null,
    warnings: string[],
  ) {
    writeAtomic(abs, code);
    let formatted = false;
    const formatter = this.detectFormatter();
    if (formatter) {
      const res = await runShell(
        this.paths.root,
        formatter.replaceAll("{file}", JSON.stringify(rel)),
      );
      if (res.ok) formatted = true;
      else warnings.push(`formatter failed: ${res.output.trim().split("\n").slice(-3).join(" ")}`);
    }
    const content = readFileSync(abs, "utf8");
    const hash = hashContent(content);
    let location: SourceLocation | null = null;
    if (trackIndex !== null) {
      try {
        const el = collectElements(parseTsx(content))[trackIndex]?.node;
        if (el) location = locationOf(el, rel);
      } catch {
        /* unparsable after format; unlikely */
      }
    }
    this.onFileWritten(rel, hash);
    return {
      content,
      result: {
        file: rel,
        hash,
        changed: true,
        location,
        formatted,
        warnings,
      } satisfies EditResult,
    };
  }

  async undo(): Promise<EditResult | null> {
    const entry = this.journal[this.cursor - 1];
    if (!entry) return null;
    return this.queue.run(entry.file, async () => {
      const { content, abs } = this.read(entry.file);
      if (content !== entry.after) {
        this.invalidated = `${entry.file} changed outside the editor since "${entry.label}"; older undo entries were dropped`;
        this.journal = this.journal.slice(this.cursor);
        this.cursor = 0;
        this.emitState();
        throw new AppError("stale", this.invalidated);
      }
      writeAtomic(abs, entry.before);
      const hash = hashContent(entry.before);
      this.cursor -= 1;
      this.onFileWritten(entry.file, hash);
      this.emitState();
      return {
        file: entry.file,
        hash,
        changed: true,
        location: null,
        formatted: true,
        warnings: [],
      };
    });
  }

  async redo(): Promise<EditResult | null> {
    const entry = this.journal[this.cursor];
    if (!entry) return null;
    return this.queue.run(entry.file, async () => {
      const { content, abs } = this.read(entry.file);
      if (content !== entry.before) {
        this.invalidated = `${entry.file} changed outside the editor; redo history was dropped`;
        this.journal = this.journal.slice(0, this.cursor);
        this.emitState();
        throw new AppError("stale", this.invalidated);
      }
      writeAtomic(abs, entry.after);
      const hash = hashContent(entry.after);
      this.cursor += 1;
      this.onFileWritten(entry.file, hash);
      this.emitState();
      let location: SourceLocation | null = null;
      if (entry.trackIndex !== null) {
        const el = collectElements(parseTsx(entry.after))[entry.trackIndex]?.node;
        if (el) location = locationOf(el, entry.file);
      }
      return { file: entry.file, hash, changed: true, location, formatted: true, warnings: [] };
    });
  }
}
