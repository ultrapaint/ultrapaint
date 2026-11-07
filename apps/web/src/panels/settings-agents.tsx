/**
 * The settings of the agents: the MCP connection they reach the editor by, the skills they are
 * given, the key that sends a prompt, and what a new chat starts with.
 */
import type {
  Skill,
  SkillsBriefing,
  SkillsConfig,
} from "@ultrapaint/contracts/skills";
import {
  type AgentOptions,
  type ChatDefaults,
  isEffortOption,
  isModelOption,
  type McpConnection,
  namedChoices,
  startingMode,
  withNamedChoices,
} from "@ultrapaint/contracts/threads";
import { Check, Copy } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { IconButton } from "../components/icon-button.tsx";
import { Markdown } from "../components/markdown.tsx";
import { OptionSelect } from "../components/option-select.tsx";
import { Segmented } from "../components/segmented.tsx";
import { type AgentSetup, type PlatformAgent, platform } from "../platform.ts";
import { useAgents } from "../state/agents.ts";
import { api } from "../state/connection.ts";
import { readiness, useMachineAgents } from "../state/machine-agents.ts";
import { reportError } from "../state/project.ts";
import { type SendKey, useSendKey } from "../state/send-key.ts";
import { useSkills } from "../state/skills.ts";
import { Group, Row, rowSelect } from "./settings-group.tsx";

const skillsBriefings = [
  { label: "Core", value: "router" },
  { label: "Whole", value: "full" },
  { label: "Summaries", value: "summaries" },
];

/** What a design thread is told, for each way of telling the skills. */
const briefingDescriptions: Record<SkillsBriefing, string> = {
  full: "The design skill’s core and every reference, whole: about 145,000 characters before the first prompt.",
  router:
    "The design skill’s core, every rule and the steps, about 22,000 characters; a reference is read when the core sends the agent to it.",
  summaries:
    "Each skill’s title and summary, a few hundred characters; a skill is read whole before its work.",
};

/** The settings' skills with one changed, absent when they say only what is the default. */
const skillsWith = (
  config: SkillsConfig | undefined,
  change: SkillsConfig
): SkillsConfig | undefined => {
  const { briefing, disabled } = { ...config, ...change };
  const next = {
    ...(briefing === undefined || briefing === "router" ? {} : { briefing }),
    ...(disabled && disabled.length > 0 ? { disabled } : {}),
  };
  return Object.keys(next).length === 0 ? undefined : next;
};

const sendKeys = [
  { label: "Enter", value: "enter" },
  { label: "⌘/Ctrl+Enter", value: "modEnter" },
];

/**
 * How to point something else at this project: an agent in a terminal, another editor. The same
 * tools the threads here use, over the same server, reached with the project's own token.
 */
export const McpConnectionGroup = () => {
  const [connection, setConnection] = useState<McpConnection | null>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    api()
      .request("mcp.connection", undefined)
      .then(setConnection)
      .catch(reportError);
  }, []);
  if (!connection?.enabled) {
    return null;
  }
  const command = `claude mcp add --transport http ultrapaint ${connection.url} --header "${connection.header}: ${connection.token}"`;
  const copy = () => {
    navigator.clipboard
      .writeText(command)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      })
      .catch(reportError);
  };
  return (
    <Group title="Outside the editor">
      <Row
        description="Gives an agent in a terminal this project’s pages, components and comments. Anyone with the token can use them."
        layout="below"
        title="Connect over MCP"
      >
        <div className="flex min-w-0 items-center gap-1 rounded-md bg-muted py-0.5 pr-0.5 pl-2">
          <code className="min-w-0 flex-1 select-text overflow-x-auto whitespace-pre py-1 font-code">
            {command}
          </code>
          <IconButton onClick={copy} size="icon-sm" tooltip="Copy command">
            {copied ? <Check /> : <Copy />}
          </IconButton>
        </div>
        {connection.replaced ? (
          <p className="font-small text-destructive">
            The token changed. Copy the command again for agents connected
            before.
          </p>
        ) : null}
      </Row>
    </Group>
  );
};

/** One skill: on or off, and what it says. */
const SkillRow = ({
  enabled,
  onToggle,
  skill,
}: {
  enabled: boolean;
  onToggle: (enabled: boolean) => void;
  skill: Skill;
}) => {
  const [shown, setShown] = useState(false);
  const id = `settings-skill-${skill.name}`;
  return (
    <Row
      description={
        <>
          <span className="line-clamp-2" title={skill.summary}>
            {skill.summary}
          </span>
          {skill.file ? (
            <span className="mt-0.5 block">{skill.file}</span>
          ) : null}
          {shown ? (
            <div className="mt-2 max-h-96 overflow-y-auto rounded-md bg-muted p-3 font-body text-foreground">
              <Markdown>{skill.text}</Markdown>
            </div>
          ) : null}
        </>
      }
      htmlFor={id}
      title={skill.title}
    >
      <div className="flex items-center gap-1">
        <Button onClick={() => setShown((v) => !v)} size="sm" variant="ghost">
          {shown ? "Hide" : "View"}
        </Button>
        <Switch
          aria-label={skill.title}
          checked={enabled}
          className="ml-2"
          id={id}
          onCheckedChange={onToggle}
        />
      </div>
    </Row>
  );
};

/**
 * The design skills every agent is told before it designs: the tool's design skill, and the
 * project's own files beside it; any is turned off here.
 */
export const SkillsGroup = ({
  config,
  onChange,
}: {
  config: SkillsConfig | undefined;
  onChange: (config: SkillsConfig | undefined) => void;
}) => {
  const dir = useSkills((s) => s.dir);
  const loaded = useSkills((s) => s.loaded);
  const skills = useSkills((s) => s.skills);
  useEffect(() => {
    if (!loaded) {
      useSkills.getState().load();
    }
  }, [loaded]);
  if (skills.length === 0) {
    return null;
  }
  const off = new Set(config?.disabled);
  const onToggle = (name: string, enabled: boolean) => {
    const others = [...off].filter((n) => n !== name);
    onChange(
      skillsWith(config, { disabled: enabled ? others : [...others, name] })
    );
  };
  const briefing = config?.briefing ?? "router";
  return (
    <Group
      note={
        <>
          Told to every agent before it designs. Each file in{" "}
          <code className="font-code">{dir}</code> is a skill of the project’s
          own, told after the design skill.
        </>
      }
      title="Design skills"
    >
      <Row description={briefingDescriptions[briefing]} title="Told as">
        <OptionSelect
          className={rowSelect}
          onChange={(value) =>
            onChange(skillsWith(config, { briefing: value as SkillsBriefing }))
          }
          options={skillsBriefings}
          value={briefing}
        />
      </Row>
      {skills.map((skill) => (
        <SkillRow
          enabled={!off.has(skill.name)}
          key={skill.name}
          onToggle={(enabled) => onToggle(skill.name, enabled)}
          skill={skill}
        />
      ))}
    </Group>
  );
};

/** Kept in this browser rather than the settings file, so it applies at once and to every project. */
export const SendKeyRow = () => {
  const sendKey = useSendKey((s) => s.sendKey);
  const setSendKey = useSendKey((s) => s.setSendKey);
  return (
    <Row
      description={
        sendKey === "enter"
          ? "Shift+Enter starts a new line."
          : "Enter starts a new line."
      }
      title="Send key"
    >
      <OptionSelect
        className={rowSelect}
        onChange={(v) => setSendKey(v as SendKey)}
        options={sendKeys}
        value={sendKey}
      />
    </Row>
  );
};

/**
 * The agent, model, effort and permissions a new chat starts with (ADR 0063), for this project on
 * this computer: the agents and their sign-ins are the machine's. Saved as soon as it is picked;
 * a chat can still change each in its model menu. Another agent starts from its own defaults.
 */
export const ChatDefaultsGroup = () => {
  const agents = useAgents((s) => s.agents);
  // Which are installed and signed in on this computer, where the shell can tell (Platform).
  const machine = useMachineAgents((s) => s.agents);
  const [known, setKnown] = useState<readonly AgentOptions[]>([]);
  const [defaults, setDefaults] = useState<ChatDefaults | null>(null);
  /** Why the chosen agent could not list its models, once it has been asked. */
  const [unlisted, setUnlisted] = useState<Record<string, string>>({});
  // The agents are the chat's list; what each offers and the defaults are this form's own.
  useEffect(() => {
    useAgents.getState().load();
    Promise.all([
      api().request("agents.options", undefined),
      api().request("chat.defaults", undefined),
    ])
      .then(([options, stored]) => {
        setKnown(options);
        setDefaults(stored);
      })
      .catch(reportError);
  }, []);
  const agentId =
    agents.find((a) => a.id === defaults?.agentId)?.id ?? agents[0]?.id ?? "";
  const asked = !defaults || known.some((k) => k.agentId === agentId);
  // An agent never run here is asked now; the server shares the answer with its own asking.
  useEffect(() => {
    if (asked || !agentId) {
      return;
    }
    let live = true;
    api()
      .request("agents.discover", { agentId })
      .then((options) => {
        if (live) {
          setKnown((k) => [...k.filter((x) => x.agentId !== agentId), options]);
        }
      })
      .catch((error: { message?: string }) => {
        if (live) {
          setUnlisted((u) => ({
            ...u,
            [agentId]: error.message ?? String(error),
          }));
        }
      });
    return () => {
      live = false;
    };
  }, [agentId, asked]);
  if (!defaults || agents.length === 0) {
    return null;
  }
  const listed = known.find((k) => k.agentId === agentId);
  const modelOption = listed?.configOptions.find(isModelOption);
  const models = modelOption ? namedChoices(modelOption) : [];
  // The agent's unnamed default stands for the value it names, as the composer shows it.
  const effortOption = withNamedChoices(listed?.configOptions ?? []).find(
    isEffortOption
  );
  const efforts = effortOption ? namedChoices(effortOption) : [];
  const modes = listed?.modes ?? [];
  const save = (next: ChatDefaults) => {
    setDefaults(next);
    api().request("chat.setDefaults", next).catch(reportError);
  };
  // Another agent's models, efforts and modes are its own: they start from its defaults.
  const onAgent = (id: string) => save({ agentId: id });
  const problem = unlisted[agentId];
  let modelDescription: string | undefined;
  if (problem !== undefined) {
    modelDescription = problem;
  } else if (!listed) {
    modelDescription = "Asking the agent for its models…";
  } else if (models.length === 0) {
    modelDescription = "This agent has one model.";
  }
  const kept = { ...defaults, agentId };
  const effort = defaults.effort ?? effortOption?.currentValue ?? null;
  const modeId =
    defaults.modeId ?? startingMode(modes, listed?.currentModeId) ?? null;
  const mode = modes.find((m) => m.id === modeId);
  return (
    <Group title="New chats">
      <Row title="Agent">
        <OptionSelect
          className={rowSelect}
          onChange={onAgent}
          options={agents.map((a) => {
            const word = readiness(machine[a.id]);
            return {
              ...(word === null ? {} : { description: word }),
              label: a.name,
              value: a.id,
            };
          })}
          value={agentId}
        />
      </Row>
      <Row description={modelDescription} title="Model">
        <OptionSelect
          className={rowSelect}
          disabled={models.length === 0}
          onChange={(model) => save({ ...kept, model })}
          options={models.map((m) => ({
            description: m.description,
            label: m.name,
            value: m.value,
          }))}
          // Unset, a thread starts with the first model the agent names.
          value={defaults.model ?? models[0]?.value ?? null}
        />
      </Row>
      {efforts.length > 0 ? (
        <Row title="Effort">
          <Segmented
            className="@xl:w-auto"
            onChange={(value) => save({ ...kept, effort: value })}
            options={efforts.map((e) => ({ label: e.name, value: e.value }))}
            value={effort}
          />
        </Row>
      ) : null}
      {modes.length > 0 ? (
        <Row description={mode?.description} title="Permissions">
          <OptionSelect
            className={rowSelect}
            onChange={(value) => save({ ...kept, modeId: value })}
            options={modes.map((m) => ({ label: m.name, value: m.id }))}
            value={modeId}
          />
        </Row>
      ) : null}
    </Group>
  );
};

/** Where an agent's executable was found, for the row that says so. */
const foundAt = (agent: PlatformAgent) => {
  const where = {
    download: "downloaded by the app",
    path: "on your PATH",
    setting: "chosen here",
  }[agent.source ?? "path"];
  return [agent.version, `${agent.executable}, ${where}`]
    .filter(Boolean)
    .join(" · ");
};

const megabytes = (bytes: number) =>
  `${Math.max(1, Math.round(bytes / 1e6))} MB`;

/** How far a download got, in a word. */
const downloadLabel = (progress: NonNullable<PlatformAgent["downloading"]>) => {
  if (progress.phase === "verifying") {
    return "Checking the download…";
  }
  if (progress.phase === "unpacking") {
    return "Unpacking…";
  }
  return progress.total > 0
    ? `Downloading… ${Math.floor((progress.received / progress.total) * 100)}%`
    : "Downloading…";
};

/** A key for Claude Code, kept by the desktop app with the system's keychain. */
const ApiKeyField = ({
  busy,
  onSave,
}: {
  busy: boolean;
  onSave: (key: string) => void;
}) => {
  const [key, setKey] = useState("");
  return (
    <div className="flex @xl:w-80 w-full gap-1">
      <Input
        aria-label="API key"
        autoComplete="off"
        onChange={(e) => setKey(e.target.value)}
        placeholder="sk-ant-…"
        type="password"
        value={key}
      />
      <Button
        disabled={busy || key.trim() === ""}
        onClick={() => onSave(key.trim())}
        variant="outline"
      >
        Save key
      </Button>
    </div>
  );
};

/** One agent on this computer: where it is, whether it is signed in, and what can be done. */
const MachineAgentRow = ({
  agent,
  busy,
  change,
  setup,
}: {
  agent: PlatformAgent;
  busy: boolean;
  change: (run: () => Promise<void>) => void;
  setup: AgentSetup;
}) => {
  const progress = agent.downloading;
  const downloading = progress !== undefined && progress.phase !== "failed";
  const offersKey =
    agent.canKeepKey === true && !agent.apiKey && agent.state === "signed-out";
  return (
    <Row
      description={
        <>
          {agent.executable ? (
            <span className="block truncate" title={foundAt(agent)}>
              {foundAt(agent)}
            </span>
          ) : null}
          {agent.detail ? <span className="block">{agent.detail}</span> : null}
          {progress?.phase === "failed" ? (
            <span className="block text-destructive">
              The download failed: {progress.message}
            </span>
          ) : null}
          {agent.state === "missing" ? (
            <span className="block">
              <a
                className="underline underline-offset-3 hover:text-foreground"
                href={agent.install}
                rel="noreferrer"
                target="_blank"
              >
                Install {agent.name}
              </a>
              {agent.download
                ? `, or download ${agent.download.version} into the app.`
                : null}
            </span>
          ) : null}
        </>
      }
      title={agent.name}
    >
      <div className="flex flex-col @xl:items-end gap-1.5">
        <div className="flex flex-wrap items-center @xl:justify-end gap-1">
          {downloading ? (
            <span className="font-small text-muted-foreground">
              {downloadLabel(progress)}
            </span>
          ) : null}
          {agent.state === "missing" && agent.download && !downloading ? (
            <Button
              disabled={busy}
              onClick={() => change(() => setup.download(agent.id))}
              size="sm"
              variant="secondary"
            >
              Download ({megabytes(agent.download.size)})
            </Button>
          ) : null}
          {agent.state === "signed-out" && agent.signInWith ? (
            <Button
              disabled={busy}
              onClick={() => change(() => setup.signIn(agent.id))}
              size="sm"
              variant="secondary"
            >
              Sign in with {agent.signInWith}
            </Button>
          ) : null}
          {agent.apiKey ? (
            <Button
              disabled={busy}
              onClick={() => change(() => setup.setApiKey(agent.id, null))}
              size="sm"
              variant="ghost"
            >
              Forget key
            </Button>
          ) : null}
          {agent.customPath ? (
            <Button
              disabled={busy}
              onClick={() => change(() => setup.clearPath(agent.id))}
              size="sm"
              variant="ghost"
            >
              Use PATH
            </Button>
          ) : null}
          <Button
            disabled={busy}
            onClick={() => change(() => setup.choosePath(agent.id))}
            size="sm"
            title={`Choose the ${agent.name} executable`}
            variant="outline"
          >
            Choose…
          </Button>
        </div>
        {offersKey ? (
          <ApiKeyField
            busy={busy}
            onSave={(key) => change(() => setup.setApiKey(agent.id, key))}
          />
        ) : null}
      </div>
    </Row>
  );
};

/**
 * The agents on this computer, as the desktop app finds them: installed or not, signed in or
 * not, and where. A missing one can be downloaded into the app, or pointed at; Codex signs in
 * with ChatGPT from here, Claude Code by itself in a terminal or with an API key. A change to
 * where an agent is, or to its key, starts the project's server again. Nothing in a browser.
 */
export const MachineAgentsGroup = () => {
  const setup = platform().agents;
  const agents = useMachineAgents((s) => s.agents);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    useMachineAgents.getState().load().catch(reportError);
  }, []);
  // While something runs (a download, a sign-in in the browser), how it goes is asked again.
  useEffect(() => {
    if (!busy) {
      return;
    }
    const timer = setInterval(() => {
      useMachineAgents.getState().load().catch(reportError);
    }, 1000);
    return () => clearInterval(timer);
  }, [busy]);
  if (!setup) {
    return null;
  }
  const change = (run: () => Promise<void>) => {
    setBusy(true);
    run()
      .catch(reportError)
      .then(() => useMachineAgents.getState().load())
      .catch(reportError)
      .finally(() => setBusy(false));
  };
  return (
    <Group title="On this computer">
      {Object.values(agents).map((agent) => (
        <MachineAgentRow
          agent={agent}
          busy={busy}
          change={change}
          key={agent.id}
          setup={setup}
        />
      ))}
    </Group>
  );
};
