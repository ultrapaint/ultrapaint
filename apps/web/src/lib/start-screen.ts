/**
 * What the desktop app's start screen works out before it writes a project (ADR 0062): the
 * project's name from the prompt, and the models it offers from what the chat remembers, with
 * no server behind it.
 */
import type {
  ChatPreferencesFile,
  ConfigOption,
} from "@ultrapaint/contracts/threads";
import {
  isEffortOption,
  isModelOption,
  namedChoices,
  withNamedChoices,
} from "@ultrapaint/contracts/threads";
import type { PlatformAgent } from "../platform.ts";

/** Words a request opens with that name nothing: "make me a", "I want an". */
const OPENING_WORDS = new Set([
  "a",
  "an",
  "build",
  "create",
  "design",
  "draw",
  "i",
  "i'd",
  "i’d",
  "like",
  "make",
  "me",
  "my",
  "need",
  "new",
  "our",
  "please",
  "the",
  "to",
  "want",
  "we",
]);

/** Words after which a request says what the thing is for, not what it is. */
const CLAUSE_WORDS = new Set([
  "about",
  "and",
  "for",
  "from",
  "in",
  "like",
  "of",
  "on",
  "that",
  "to",
  "using",
  "where",
  "which",
  "who",
  "with",
]);

const WORD_RE = /[\p{L}\p{N}'’-]+/gu;

/** At most this many words name a project. */
const NAME_WORDS = 4;

/**
 * A project's name from its prompt: what it is, without the request around it ("Make me a
 * booking app for a climbing gym" is "Booking app"); `Untitled` when nothing is left.
 */
export const projectNameOf = (prompt: string): string => {
  const words = prompt.split("\n")[0]?.match(WORD_RE) ?? [];
  let start = 0;
  while (
    start < words.length &&
    OPENING_WORDS.has(words[start]?.toLowerCase() ?? "")
  ) {
    start += 1;
  }
  const kept: string[] = [];
  for (const word of words.slice(start)) {
    if (CLAUSE_WORDS.has(word.toLowerCase()) || kept.length === NAME_WORDS) {
      break;
    }
    kept.push(word);
  }
  const name = kept.join(" ");
  return name ? name.charAt(0).toUpperCase() + name.slice(1) : "Untitled";
};

/** A model the start screen offers: an agent's, or the agent itself while none is known. */
export interface StartModel {
  readonly agentId: string;
  readonly agentName: string;
  /** The effort its sessions last ran at, shown beside the model. */
  readonly effort?: string;
  /** The model's name, or the agent's when it has no model known yet. */
  readonly label: string;
  /** A value of the agent's model option; absent, the agent picks. */
  readonly model?: string;
}

const currentName = (option: ConfigOption | undefined) =>
  option?.options.find((o) => o.value === option.currentValue)?.name;

/**
 * Every model of the agents that can run here (found, signed in or not), in the agents' order,
 * from the options their sessions offered last; an agent that never ran is offered as itself.
 */
export const startModels = (
  agents: readonly PlatformAgent[],
  preferences: ChatPreferencesFile
): readonly StartModel[] =>
  agents
    .filter((agent) => agent.state !== "missing")
    .flatMap((agent): StartModel[] => {
      const known = preferences.agents.find((a) => a.agentId === agent.id);
      const options = withNamedChoices(known?.configOptions ?? []);
      const model = options.find(isModelOption);
      const effort = currentName(options.find(isEffortOption));
      const base = {
        agentId: agent.id,
        agentName: agent.name,
        ...(effort === undefined ? {} : { effort }),
      };
      if (!model) {
        return [{ ...base, label: agent.name }];
      }
      return namedChoices(model).map((choice) => ({
        ...base,
        label: choice.name,
        model: choice.value,
      }));
    });

/**
 * The one chosen at first: the chat's default agent and model, else the first agent signed in,
 * at the model its sessions last ran, else the first offered.
 */
export const firstStartModel = (
  models: readonly StartModel[],
  agents: readonly PlatformAgent[],
  preferences: ChatPreferencesFile
): StartModel | undefined => {
  const { agentId, model } = preferences.defaults;
  const chosen = models.find(
    (m) => m.agentId === agentId && (model === undefined || m.model === model)
  );
  if (chosen) {
    return chosen;
  }
  const ready = agents.find((a) => a.state === "ready");
  const current = withNamedChoices(
    preferences.agents.find((a) => a.agentId === ready?.id)?.configOptions ?? []
  ).find(isModelOption)?.currentValue;
  return (
    models.find(
      (m) =>
        m.agentId === ready?.id &&
        (current === undefined || m.model === current)
    ) ?? models[0]
  );
};
