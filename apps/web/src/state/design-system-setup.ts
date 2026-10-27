/**
 * The design-system setup (ADR 0023): where each step is, what the code reads as (the inventory,
 * and the audit against the saved design system), the mapping, and Migrate's batches. The Setup
 * view of the Design system panel and the banner of a step's thread read it from here; the server
 * says when a step or the mapping moves, whoever moved it.
 */
import type {
  DefineMode,
  DesignSystemSetup,
  MappingChange,
  RestoreEntry,
  SetupStepId,
  UsageInventory,
  UsageMapping,
} from "@ultrapaint/contracts/design-system-setup";
import { setupStepOf } from "@ultrapaint/contracts/design-system-setup";
import { commandOf } from "@ultrapaint/contracts/tasks";
import { toast } from "sonner";
import { create } from "zustand";
import { confirmDialog } from "../components/dialogs.tsx";
import { useDrafts } from "../lib/start-thread.ts";
import { useAgents } from "./agents.ts";
import { api } from "./connection.ts";
import { useEditor } from "./editor.ts";
import { reportError } from "./project.ts";

interface SetupStore {
  /** The code read against the saved design system, by Map and Verify. */
  audit: UsageInventory | null;
  /** The step, or the batch, a request is under way for, so its buttons wait. */
  busy: string | null;
  complete: (step: SetupStepId) => Promise<void>;
  inventory: UsageInventory | null;
  load: () => Promise<void>;
  loaded: boolean;
  mapping: UsageMapping | null;
  /** Puts back what a step and the later ones changed, once the user has seen the list. */
  redo: (step: SetupStepId) => Promise<void>;
  resume: (step: SetupStepId) => Promise<void>;
  /** Puts back what a batch of Migrate changed, once the user has seen the list. */
  revertBatch: (batchId: string) => Promise<void>;
  /** The user's decision on a value of the mapping. */
  setMapping: (change: MappingChange) => Promise<void>;
  setup: DesignSystemSetup | null;
  /** Shows the steps in the Design system panel, or its tokens. */
  show: (shown: boolean) => void;
  /** Whether the Design system panel shows the steps rather than the tokens. */
  shown: boolean;
  start: (step: SetupStepId, mode?: DefineMode) => Promise<void>;
  stop: (step: SetupStepId) => Promise<void>;
}

/** The files a confirmation lists before the rest is counted. */
const LISTED = 8;
/** The steps that read the code: when one of them moves, what it read is fetched again. */
const READING_STEPS: readonly SetupStepId[] = ["inventory", "map", "verify"];

let bound = false;

/** Opens a step's thread in the chat, with its command in the composer when it is new. */
export const openStepThread = (threadId: string, draft?: string) => {
  if (draft) {
    useDrafts.setState((s) => ({ drafts: { ...s.drafts, [threadId]: draft } }));
  }
  useEditor.getState().setLeftTab("chat");
  useAgents
    .getState()
    .open(threadId)
    .catch(() => undefined);
};

/** Back from a step's thread to the steps. */
export const showSetup = () => {
  useEditor.getState().setLeftTab("designSystem");
  useDesignSystemSetup.getState().show(true);
};

/** What tells a reading step's result changed: its status and when it started. */
const readingsOf = (setup: DesignSystemSetup | null) =>
  (setup?.steps ?? [])
    .filter((s) => READING_STEPS.includes(s.id))
    .map((s) => `${s.id}:${s.status === "todo" ? "" : (s.startedAt ?? "")}`)
    .join(",");

/** The files a put-back touches, as a confirmation lists them. */
const listed = (files: readonly RestoreEntry[]) => [
  ...files
    .slice(0, LISTED)
    .map((f) => `${f.action === "delete" ? "Delete" : "Put back"} ${f.path}`),
  ...(files.length > LISTED ? [`and ${files.length - LISTED} more`] : []),
];

/** Asks before putting files back, listing them; true when the user goes ahead. */
const confirmPutBack = (options: {
  readonly after: string;
  readonly files: readonly RestoreEntry[];
  readonly since: string;
  readonly title: string;
}) =>
  confirmDialog({
    confirmLabel: options.files.length > 0 ? "Put back" : "Go ahead",
    description: [
      options.files.length > 0
        ? `These files go back to how they were ${options.since}:`
        : "No file it changed is different now.",
      ...listed(options.files),
      options.after,
    ]
      .filter(Boolean)
      .join("\n"),
    destructive: options.files.length > 0,
    title: options.title,
  });

export const useDesignSystemSetup = create<SetupStore>((set, get) => {
  /** What the reading steps found, fetched again. */
  const fetchReadings = async () => {
    const [inventory, audit, mapping] = await Promise.all([
      api().request("dsSetup.inventory", undefined),
      api().request("dsSetup.audit", undefined),
      api().request("dsSetup.mapping", undefined),
    ]);
    set({ audit, inventory, mapping });
  };

  /** Takes the setup the server says, and what it read when a reading step moved. */
  const take = async (setup: DesignSystemSetup) => {
    const moved = readingsOf(setup) !== readingsOf(get().setup);
    set({ setup });
    if (moved) {
      await fetchReadings();
    }
  };

  /** Runs one request; the store follows the server's events for the rest. */
  const run = async (
    busy: string,
    request: () => Promise<DesignSystemSetup | null>
  ) => {
    set({ busy });
    try {
      const setup = await request();
      if (setup) {
        await take(setup);
      }
    } catch (error) {
      reportError(error);
    } finally {
      set({ busy: null });
    }
  };

  /** What a put-back would touch, or null when it could not be worked out (and was reported). */
  const preview = async (
    busy: string,
    request: () => Promise<readonly RestoreEntry[]>
  ) => {
    set({ busy });
    try {
      return await request();
    } catch (error) {
      reportError(error);
      return null;
    } finally {
      set({ busy: null });
    }
  };

  return {
    audit: null,
    busy: null,
    complete: (step) =>
      run(step, () => api().request("dsSetup.complete", { step })),
    inventory: null,
    load: async () => {
      if (!bound) {
        bound = true;
        api().on("dsSetup", (setup) => {
          take(setup).catch(reportError);
        });
        api().on("dsSetupMapping", (mapping) => set({ mapping }));
      }
      try {
        const setup = await api().request("dsSetup.get", undefined);
        await fetchReadings();
        set({ loaded: true, setup });
      } catch (error) {
        reportError(error);
      }
    },
    loaded: false,
    mapping: null,
    redo: async (step) => {
      const files = await preview(step, () =>
        api().request("dsSetup.redoPreview", { step })
      );
      if (!files) {
        return;
      }
      const index = get().setup?.steps.findIndex((s) => s.id === step) ?? 0;
      const later = (get().setup?.steps ?? [])
        .slice(index + 1)
        .filter((s) => s.status !== "todo")
        .map((s) => setupStepOf(s.id)?.title ?? s.id);
      const title = setupStepOf(step)?.title ?? step;
      const ok = await confirmPutBack({
        after:
          later.length > 0
            ? `${later.join(" and ")} ${later.length === 1 ? "goes" : "go"} back to the start too.`
            : "",
        files,
        since: `when ${title} started`,
        title: `Redo ${title}?`,
      });
      if (ok) {
        await run(step, () => api().request("dsSetup.redo", { step }));
      }
    },
    resume: async (step) => {
      await run(step, () => api().request("dsSetup.resume", { step }));
      const threadId = get().setup?.steps.find((s) => s.id === step)?.threadId;
      if (threadId) {
        openStepThread(threadId);
      }
    },
    revertBatch: async (batchId) => {
      const files = await preview(batchId, () =>
        api().request("dsSetup.batchPreview", { batchId })
      );
      if (!files) {
        return;
      }
      const batch = get()
        .setup?.steps.find((s) => s.id === "migrate")
        ?.batches?.find((b) => b.id === batchId);
      const ok = await confirmPutBack({
        after: "The batch goes back on the list, for the agent to take again.",
        files,
        since: "before the batch was migrated",
        title: `Revert ${batch?.dir ?? "the batch"}?`,
      });
      if (ok) {
        await run(batchId, () =>
          api().request("dsSetup.revertBatch", { batchId })
        );
      }
    },
    setMapping: async (change) => {
      try {
        const { mapping, problems } = await api().request(
          "dsSetup.setMapping",
          { changes: [change] }
        );
        set({ mapping });
        for (const problem of problems) {
          toast.error(problem);
        }
      } catch (error) {
        reportError(error);
      }
    },
    setup: null,
    show: (shown) => set({ shown }),
    shown: false,
    start: async (step, mode) => {
      set({ busy: step });
      try {
        const { setup, task, threadId } = await api().request("dsSetup.start", {
          step,
          ...(mode && { mode }),
        });
        await take(setup);
        if (threadId) {
          openStepThread(threadId, task ? `${commandOf(task)} ` : undefined);
        }
      } catch (error) {
        reportError(error);
      } finally {
        set({ busy: null });
      }
    },
    stop: (step) => run(step, () => api().request("dsSetup.stop", { step })),
  };
});
