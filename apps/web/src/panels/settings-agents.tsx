/**
 * The settings of the agents: the MCP connection they reach the editor by, the skills they are
 * given, the key that sends a prompt, and what a new chat starts with.
 */
import type {
  CustomiseMode,
  Skill,
  SkillsBriefing,
  SkillsConfig,
} from "@ultrapaint/contracts/skills";
import {
  type AgentOptions,
  type ChatDefaults,
  isModelOption,
  type McpConnection,
  namedChoices,
} from "@ultrapaint/contracts/threads";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Markdown } from "../components/markdown.tsx";
import { OptionSelect } from "../components/option-select.tsx";
import { type AgentSetup, type PlatformAgent, platform } from "../platform.ts";
import { useAgents } from "../state/agents.ts";
import { api } from "../state/connection.ts";
import { readiness, useMachineAgents } from "../state/machine-agents.ts";
import { reportError } from "../state/project.ts";
import { type SendKey, useSendKey } from "../state/send-key.ts";
import { useSkills } from "../state/skills.ts";
import { Group, Row } from "./settings-group.tsx";

const skillsBriefings = [
  { label: "A router, read on demand", value: "router" },
  { label: "Whole", value: "full" },
  { label: "Titles and summaries", value: "summaries" },
];

/** What a design thread is told, for each way of telling the skills. */
const briefingDescriptions: Record<SkillsBriefing, string> = {
  full: "A design thread is told every skill that is on, whole: about 70,000 characters it reads before its first prompt.",
  router:
    "A design thread is told the design skill's router with the parts every screen needs, about 13,000 characters, and reads every other part from its reference as the screen reaches it.",
  summaries:
    "A design thread is told each skill's title and summary, about 2,500 characters, and reads a skill whole before the work it is about: from the editor's MCP server, or from its file in the repository. Without the MCP server, a built-in skill, which has no file there, is told whole.",
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
        description="Gives another agent the same tools the chats here use: the project's pages, its components, and the comments left on the designs. The token is this project's, and anyone who has it can use them."
        title="Connect an agent over MCP"
        wide
      >
        <div className="flex items-start gap-2">
          <code className="min-w-0 flex-1 select-text overflow-x-auto whitespace-pre rounded-md bg-muted px-2 py-1.5 font-code">
            {command}
          </code>
          <Button onClick={copy} size="sm" variant="outline">
            {copied ? "Copied" : "Copy"}
          </Button>
        </div>
        {connection.replaced ? (
          <p className="font-body text-destructive">
            The token has changed: copy the command again into agents connected
            before, which are turned away until then.
          </p>
        ) : null}
      </Row>
    </Group>
  );
};

const sourceLabel = (skill: Skill) => {
  if (skill.source === "built-in") {
    return "Built-in";
  }
  return skill.extends
    ? `Extends the built-in, in ${skill.file}`
    : `Replaced by ${skill.file}`;
};

/** One skill: on or off, what it says, and how the project takes it over. */
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
  const customise = (mode: CustomiseMode) => {
    useSkills
      .getState()
      .customise(skill.name, mode)
      .then((result) => {
        if (result?.file) {
          toast(`${result.file} is yours to edit.`, {
            description:
              mode === "extend"
                ? `What you write there is told after the built-in ${skill.title} skill.`
                : `It replaces the built-in ${skill.title} skill.`,
          });
        }
      });
  };
  return (
    <Row
      description={
        <>
          {skill.summary}
          <span className="mt-1 block font-body">{sourceLabel(skill)}</span>
          {shown ? (
            <span className="mt-2 block rounded-md bg-muted/40 p-3 text-foreground">
              <Markdown>{skill.text}</Markdown>
            </span>
          ) : null}
        </>
      }
      htmlFor={id}
      title={skill.title}
      wide
    >
      <div className="flex flex-wrap items-center justify-end gap-1">
        <Button onClick={() => setShown((v) => !v)} size="sm" variant="ghost">
          {shown ? "Hide" : "Show"}
        </Button>
        {skill.source === "built-in" ? (
          <>
            <Button
              onClick={() => customise("extend")}
              size="sm"
              variant="outline"
            >
              Extend…
            </Button>
            <Button
              onClick={() => customise("replace")}
              size="sm"
              variant="outline"
            >
              Replace…
            </Button>
          </>
        ) : null}
        <Switch
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
 * The design skills every agent is told before it designs. The set is the tool's; a project
 * replaces or extends one with a file, adds its own, and turns any off here.
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
      description={`Told to every agent before it designs, ahead of DESIGN.md. A file in ${dir} with a built-in's name replaces it, or extends it when the file opens with the front matter "extends: true"; a file with any other name is a skill of its own. A switch turned off is saved with the settings.`}
      title="Design skills"
    >
      <Row description={briefingDescriptions[briefing]} title="Told as">
        <OptionSelect
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
export const SendKeyGroup = () => {
  const sendKey = useSendKey((s) => s.sendKey);
  const setSendKey = useSendKey((s) => s.setSendKey);
  return (
    <Group title="Chat">
      <Row
        description={
          sendKey === "enter"
            ? "Enter sends the message; Shift+Enter starts a new line."
            : "Enter starts a new line; ⌘/Ctrl+Enter sends the message."
        }
        title="Send with"
      >
        <OptionSelect
          onChange={(v) => setSendKey(v as SendKey)}
          options={sendKeys}
          value={sendKey}
        />
      </Row>
    </Group>
  );
};

/**
 * The agent and model a new thread starts with. Saved as soon as it is picked: it is the
 * user's, not the project's, and a thread can still switch both in its composer.
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
  const save = (next: ChatDefaults) => {
    setDefaults(next);
    api().request("chat.setDefaults", next).catch(reportError);
  };
  const onAgent = (id: string) => save({ agentId: id });
  const problem = unlisted[agentId];
  let modelDescription =
    "The model the agent answers with, unless the chat picks another.";
  if (problem !== undefined) {
    modelDescription = problem;
  } else if (!listed) {
    modelDescription = "Asking the agent which models it offers…";
  } else if (models.length === 0) {
    modelDescription = "This agent offers no choice of model.";
  }
  const onModel = (model: string) => save({ agentId, model });
  return (
    <Group
      description="Applied as soon as they are picked. A chat switches agent or model in its composer."
      title="New chats"
    >
      <Row description="The agent a new chat starts with." title="Agent">
        <OptionSelect
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
          disabled={models.length === 0}
          onChange={onModel}
          options={models.map((m) => ({
            description: m.description,
            label: m.name,
            value: m.value,
          }))}
          // Unset, a thread starts with the first model the agent names.
          value={defaults.model ?? models[0]?.value ?? null}
        />
      </Row>
    </Group>
  );
};

/** Where an agent's executable was found, for the row that says so. */
const foundAt = (agent: PlatformAgent) => {
  const where = {
    download: `${agent.executable}, downloaded by the app`,
    path: `${agent.executable}, on your PATH`,
    setting: `${agent.executable}, set here`,
  }[agent.source ?? "path"];
  return agent.version ? `${agent.version} at ${where}.` : `At ${where}.`;
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
    <div className="flex w-full max-w-80 gap-1">
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
        Use the key
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
          {agent.executable ? foundAt(agent) : null} {agent.detail}
          {progress?.phase === "failed" ? (
            <span className="mt-1 block text-destructive">
              The download failed: {progress.message}
            </span>
          ) : null}
          {agent.state === "missing" ? (
            <>
              {" "}
              <a href={agent.install} rel="noreferrer" target="_blank">
                How to install it
              </a>
              {agent.download
                ? `, or download ${agent.download.version} into the app.`
                : null}
            </>
          ) : null}
        </>
      }
      title={agent.name}
      wide
    >
      <div className="flex flex-col items-end gap-1.5">
        <div className="flex flex-wrap items-center justify-end gap-1">
          {downloading ? (
            <span className="font-body text-muted-foreground">
              {downloadLabel(progress)}
            </span>
          ) : null}
          {agent.state === "missing" && agent.download && !downloading ? (
            <Button
              disabled={busy}
              onClick={() => change(() => setup.download(agent.id))}
              size="sm"
            >
              Download ({megabytes(agent.download.size)})
            </Button>
          ) : null}
          {agent.state === "signed-out" && agent.signInWith ? (
            <Button
              disabled={busy}
              onClick={() => change(() => setup.signIn(agent.id))}
              size="sm"
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
              Forget the key
            </Button>
          ) : null}
          {agent.customPath ? (
            <Button
              disabled={busy}
              onClick={() => change(() => setup.clearPath(agent.id))}
              size="sm"
              variant="ghost"
            >
              Use the PATH
            </Button>
          ) : null}
          <Button
            disabled={busy}
            onClick={() => change(() => setup.choosePath(agent.id))}
            size="sm"
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
    <Group
      description="The agents the chats run, as this computer has them. Each runs from where it is installed, with its own sign-in."
      title="On this computer"
    >
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
