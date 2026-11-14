/**
 * The settings of the agents: the MCP connection they reach the editor by, the skills they are
 * given, the key that sends a prompt, and what a new chat starts with.
 */
import {
  SKILL_INSTALL_COMMAND,
  type Skill,
  type SkillInstallFolder,
  type SkillsBriefing,
  type SkillsConfig,
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
import { Check, Copy, Ellipsis } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { AgentIcon } from "../components/agent-icon.tsx";
import { CutText } from "../components/cut-text.tsx";
import { IconButton } from "../components/icon-button.tsx";
import { Markdown } from "../components/markdown.tsx";
import { OptionSelect } from "../components/option-select.tsx";
import { Segmented } from "../components/segmented.tsx";
import { isMac } from "../lib/keys.ts";
import {
  type AgentSetup,
  type InstalledCommand,
  type PlatformAgent,
  platform,
} from "../platform.ts";
import { useAgents } from "../state/agents.ts";
import { api } from "../state/connection.ts";
import { readiness, useMachineAgents } from "../state/machine-agents.ts";
import { reportError } from "../state/project.ts";
import { type SendKey, useSendKey } from "../state/send-key.ts";
import { useSkills } from "../state/skills.ts";
import { Group, Row, RowMessage, rowField, Status } from "./settings-group.tsx";

/** A folder skill's file, shown as its folder. */
const SKILL_FILE_RE = /\/SKILL\.md$/;

const skillsBriefings = [
  { label: "Core", value: "router" },
  { label: "Whole", value: "full" },
  { label: "Summaries", value: "summaries" },
];

/** What a design thread is told, for each way of telling the skills. */
const briefingDescriptions: Record<SkillsBriefing, string> = {
  full: "The core and every reference, about 145,000 characters up front.",
  router:
    "The core’s rules and steps, about 22,000 characters; references as needed.",
  summaries: "Each skill’s summary; a skill is read whole before its work.",
};

/** The settings' skills with one changed, absent when they say only what is the default. */
export const skillsWith = (
  config: SkillsConfig | undefined,
  change: SkillsConfig
): SkillsConfig | undefined => {
  const { briefing, disabled, enabled } = { ...config, ...change };
  const next = {
    ...(briefing === undefined || briefing === "router" ? {} : { briefing }),
    ...(disabled && disabled.length > 0 ? { disabled } : {}),
    ...(enabled && enabled.length > 0 ? { enabled } : {}),
  };
  return Object.keys(next).length === 0 ? undefined : next;
};

/**
 * Whether a skill is on in the settings being edited: the design skill unless turned off, a
 * project's once turned on. Read from the form, so a switch moves as it is pressed.
 */
export const skillOn = (
  config: SkillsConfig | undefined,
  skill: Pick<Skill, "aliases" | "file" | "name" | "source">
) =>
  skill.source === "built-in"
    ? !(config?.disabled ?? []).includes(skill.name)
    : (config?.enabled ?? []).some((f) => namesSkill(skill, f));

/** Whether a project skill's file in the settings is this skill's, by its own path or an alias. */
const namesSkill = (
  skill: Pick<Skill, "aliases" | "file" | "name">,
  file: string
) =>
  file === (skill.file ?? skill.name) || (skill.aliases ?? []).includes(file);

/**
 * The skills with one turned on or off: the design skill by its name, a project's by its file,
 * its aliases dropped either way.
 */
export const skillToggled = (
  config: SkillsConfig | undefined,
  skill: Pick<Skill, "aliases" | "file" | "name" | "source">,
  on: boolean
): SkillsConfig | undefined => {
  if (skill.source === "built-in") {
    const others = (config?.disabled ?? []).filter((n) => n !== skill.name);
    return skillsWith(config, {
      disabled: on ? others : [...others, skill.name],
    });
  }
  const file = skill.file ?? skill.name;
  const others = (config?.enabled ?? []).filter((f) => !namesSkill(skill, f));
  return skillsWith(config, { enabled: on ? [...others, file] : others });
};

const sendKeys = [
  { label: "Enter", value: "enter" },
  { label: isMac ? "⌘ Enter" : "Ctrl+Enter", value: "modEnter" },
];

/**
 * How an agent outside the editor reaches the projects (ADR 0083): one line, registered once, the
 * same for every project and every restart. The agent starts `ultrapaint mcp` in the folder it
 * works in, which says which project.
 */
export const OUTSIDE_COMMANDS = [
  {
    agent: "Claude Code",
    command: "claude mcp add ultrapaint -s user -- ultrapaint mcp",
  },
  { agent: "Codex", command: "codex mcp add ultrapaint -- ultrapaint mcp" },
] as const;

/** A command to copy, on one line that scrolls. */
const CopyLine = ({ command, label }: { command: string; label: string }) => {
  const [copied, setCopied] = useState(false);
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
    <div className="flex min-w-0 items-center gap-3">
      <div className="flex min-w-0 flex-1 items-center gap-1 rounded-md bg-muted py-0.5 pr-0.5 pl-2">
        <code className="min-w-0 flex-1 select-text overflow-x-auto whitespace-pre py-1 font-code">
          {command}
        </code>
        <IconButton
          onClick={copy}
          size="icon-sm"
          tooltip={copied ? "Copied" : `Copy the ${label} command`}
        >
          {copied ? <Check /> : <Copy />}
        </IconButton>
      </div>
    </div>
  );
};

/**
 * Whether the `ultrapaint` command the lines start is on this computer, where the shell can tell
 * (the desktop app), with the way to install it when it is not (ADR 0083).
 */
const CommandRow = () => {
  const { command } = platform();
  const [installed, setInstalled] = useState<InstalledCommand | null>();
  const [installing, setInstalling] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    command?.installed().then(setInstalled).catch(reportError);
  }, [command]);
  if (!command || installed === undefined) {
    return null;
  }
  const install = () => {
    setInstalling(true);
    setProblem(null);
    command
      .install()
      .then(setInstalled, (error: unknown) =>
        setProblem(error instanceof Error ? error.message : String(error))
      )
      .finally(() => setInstalling(false));
  };
  const installButton = (label: string) => (
    <Button disabled={installing} onClick={install} variant="outline">
      {installing ? (
        <>
          <Spinner />
          Installing…
        </>
      ) : (
        label
      )}
    </Button>
  );
  let description: ReactNode;
  let control: ReactNode;
  let message: ReactNode = problem ? (
    <RowMessage kind="error">
      <p>Couldn’t install the command: {problem}</p>
    </RowMessage>
  ) : null;
  if (installed) {
    description = <code className="break-all font-code">{installed.path}</code>;
    if (!installed.onPath) {
      control = <Status tone="warning">Not on your PATH</Status>;
      message = (
        <RowMessage kind="notice">
          Its folder isn’t on your PATH yet: add it, then start the agent again.
        </RowMessage>
      );
    } else if (installed.ours && !installed.shipped) {
      control = (
        <div className="flex items-center gap-3">
          <Status tone="success">Installed</Status>
          {installButton("Install again")}
        </div>
      );
    } else {
      control = (
        <Status tone="success">
          {installed.shipped ? "Installed, linked to this app" : "Installed"}
        </Status>
      );
    }
  } else {
    description =
      "The lines above start it; this computer doesn’t have it yet.";
    control = installButton("Install");
  }
  return (
    <Row
      description={description}
      message={message}
      setting="command"
      title="Command line"
    >
      {control}
    </Row>
  );
};

/** The lines that connect an agent outside the editor, unless the server offers no MCP. */
export const McpConnectionGroup = () => {
  const [connection, setConnection] = useState<McpConnection | null>(null);
  useEffect(() => {
    api()
      .request("mcp.connection", undefined)
      .then(setConnection)
      .catch(reportError);
  }, []);
  if (!connection?.enabled) {
    return null;
  }
  return (
    <>
      <section data-setting="mcp">
        <Group
          note="Run one of these once. An agent in a terminal or another app then designs in the project of the folder it works in."
          title="Agents outside the editor"
        >
          {OUTSIDE_COMMANDS.map(({ agent, command }) => (
            <Row key={agent} layout="field" title={agent}>
              <CopyLine command={command} label={agent} />
            </Row>
          ))}
        </Group>
      </section>
      {platform().command ? (
        <Group>
          <CommandRow />
        </Group>
      ) : null}
    </>
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
          <CutText className="line-clamp-2">{skill.summary}</CutText>
          {skill.file ? (
            <code className="mt-0.5 block truncate font-code">
              {skill.file.replace(SKILL_FILE_RE, "")}
            </code>
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
          {shown ? "Hide" : "Read"}
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
  message,
  onChange,
}: {
  config: SkillsConfig | undefined;
  /** Why a change wasn't saved. */
  message?: ReactNode;
  onChange: (config: SkillsConfig | undefined) => void;
}) => {
  const loaded = useSkills((s) => s.loaded);
  const skills = useSkills((s) => s.skills);
  useEffect(() => {
    if (!loaded) {
      useSkills.getState().load();
    }
  }, [loaded]);
  const shipped = skills.filter((s) => s.source === "built-in");
  const own = skills.filter((s) => s.source === "project");
  const briefing = config?.briefing ?? "router";
  const row = (skill: Skill) => (
    <SkillRow
      enabled={skillOn(config, skill)}
      key={skill.file ?? skill.name}
      onToggle={(on) => onChange(skillToggled(config, skill, on))}
      skill={skill}
    />
  );
  return (
    <>
      <section data-setting="skills">
        <Group
          message={message}
          note="Told to every chat in this project before it designs."
          title="Design skill"
        >
          {shipped.map(row)}
          <Row
            description={briefingDescriptions[briefing]}
            onReset={
              briefing === "router"
                ? undefined
                : () => onChange(skillsWith(config, { briefing: "router" }))
            }
            setting="skills-sent-as"
            title="Sent as"
          >
            <Segmented<SkillsBriefing>
              aria-label="Sent as"
              onChange={(value) =>
                onChange(skillsWith(config, { briefing: value }))
              }
              options={skillsBriefings.map((b) => ({
                label: b.label,
                value: b.value as SkillsBriefing,
              }))}
              value={briefing}
            />
          </Row>
        </Group>
      </section>
      <section data-setting="project-skills">
        <Group
          note="Skills found in this project. One turned on is told to every new chat here, after Ultrapaint’s."
          title="In this project"
        >
          {own.length > 0 ? (
            own.map(row)
          ) : (
            <div className="flex flex-col gap-0.5 px-4 py-3">
              <span className="font-body">No other skills yet</span>
              <span className="text-pretty font-body-small text-muted-foreground">
                A skill is a folder with a{" "}
                <code className="font-code">SKILL.md</code> in{" "}
                <code className="font-code">.claude/skills</code>,{" "}
                <code className="font-code">.agents/skills</code> or{" "}
                <code className="font-code">skills</code>.
              </span>
            </div>
          )}
        </Group>
      </section>
      <InstallSkillGroup />
    </>
  );
};

/** What goes before the `i`th of `count` things in a sentence: "a, b and c". */
const listJoin = (i: number, count: number) => {
  if (i === 0) {
    return null;
  }
  return i === count - 1 ? " and " : ", ";
};

const INSTALL_INTO: readonly { into: SkillInstallFolder; label: string }[] = [
  { into: ".claude/skills", label: "For Claude Code" },
  { into: ".agents/skills", label: "For other agents" },
];

/**
 * Ultrapaint's skill for agents outside the tool (ADR 0094): installed with the open skills
 * installer, or saved into this repository, where a copy already there is said and replaced.
 */
const InstallSkillGroup = () => {
  const installed = useSkills((s) => s.installed);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const save = (into: SkillInstallFolder) => {
    setSaving(true);
    setProblem(null);
    api()
      .request("skills.install", { into })
      .then((folder) => toast.success(`Saved Ultrapaint’s skill in ${folder}`))
      .catch((error: Error) =>
        setProblem(`Couldn’t save the skill (${error.message}). Try again.`)
      )
      .finally(() => setSaving(false));
  };
  return (
    <section data-setting="install-skill">
      <Group
        note="Ultrapaint tells its own skill to its chats. To use it with agents outside Ultrapaint, install it, or save a copy in this repository."
        title="Use it outside Ultrapaint"
      >
        <Row
          description="With the open skills installer, for the agents you pick."
          layout="field"
          title="Install"
        >
          <CopyLine command={SKILL_INSTALL_COMMAND} label="install" />
        </Row>
        <Row
          description={
            installed.length > 0 ? (
              <>
                Saved in{" "}
                {installed.map((folder, i) => (
                  <span key={folder}>
                    {listJoin(i, installed.length)}
                    <code className="font-code">{folder}</code>
                  </span>
                ))}
                . Saving again brings it up to date.
              </>
            ) : (
              "A copy your team’s agents read, committed with the code."
            )
          }
          message={
            problem ? <RowMessage kind="error">{problem}</RowMessage> : null
          }
          title="Save in this repository"
        >
          <DropdownMenu>
            <DropdownMenuTrigger
              render={<Button disabled={saving} variant="outline" />}
            >
              {saving ? <Spinner /> : null}
              {saving ? "Saving…" : "Save…"}
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {INSTALL_INTO.map(({ into, label }) => (
                <DropdownMenuItem key={into} onClick={() => save(into)}>
                  <span className="flex flex-col">
                    <span>{label}</span>
                    <code className="font-code text-muted-foreground">
                      {into}/ultrapaint
                    </code>
                  </span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </Row>
      </Group>
    </section>
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
      onReset={sendKey === "enter" ? undefined : () => setSendKey("enter")}
      setting="send-key"
      title="Send key"
    >
      <Segmented<SendKey>
        aria-label="Send key"
        onChange={setSendKey}
        options={sendKeys.map((k) => ({
          label: k.label,
          value: k.value as SendKey,
        }))}
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
  /** The defaults the server holds: what a save that fails goes back to. */
  const stored = useRef<ChatDefaults | null>(null);
  /** Why the chosen agent could not list its models, once it has been asked. */
  const [unlisted, setUnlisted] = useState<Record<string, string>>({});
  // The agents are the chat's list; what each offers and the defaults are this form's own.
  useEffect(() => {
    useAgents.getState().load();
    Promise.all([
      api().request("agents.options", undefined),
      api().request("chat.defaults", undefined),
    ])
      .then(([options, read]) => {
        setKnown(options);
        stored.current = read;
        setDefaults(read);
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
    api()
      .request("chat.setDefaults", next)
      .then(() => {
        stored.current = next;
      })
      .catch((error: unknown) => {
        // The server kept what it had: the form shows that again, unless picked anew since.
        setDefaults((now) => (now === next ? stored.current : now));
        reportError(error);
      });
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
    <Group
      note="What a new chat in this project starts with. A chat can change each in its model menu."
      title="New chats"
    >
      <Row htmlFor="settings-chat-agent" setting="chat-agent" title="Agent">
        <OptionSelect
          className={rowField}
          id="settings-chat-agent"
          onChange={onAgent}
          options={agents.map((a) => {
            const word = readiness(machine[a.id]);
            return {
              ...(word === null ? {} : { description: word }),
              label: a.name,
              preview: <AgentIcon agentId={a.id} className="size-4" />,
              value: a.id,
            };
          })}
          value={agentId}
        />
      </Row>
      <Row
        description={modelDescription}
        htmlFor="settings-chat-model"
        setting="chat-model"
        title="Model"
      >
        <OptionSelect
          className={rowField}
          disabled={models.length === 0}
          id="settings-chat-model"
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
        <Row setting="chat-effort" title="Effort">
          <Segmented
            aria-label="Effort"
            className="@xl:w-auto"
            onChange={(value) => save({ ...kept, effort: value })}
            options={efforts.map((e) => ({
              label: effortWord(e.name),
              value: e.value,
            }))}
            value={effort}
          />
        </Row>
      ) : null}
      {modes.length > 0 ? (
        <Row
          description={mode?.description}
          htmlFor="settings-chat-permissions"
          setting="chat-permissions"
          title="Permissions"
        >
          <OptionSelect
            className={rowField}
            id="settings-chat-permissions"
            onChange={(value) => save({ ...kept, modeId: value })}
            options={modes.map((m) => ({ label: m.name, value: m.id }))}
            value={modeId}
          />
        </Row>
      ) : null}
    </Group>
  );
};

/** An effort's name as the agents write "extra high". */
const XHIGH_RE = /^x[- ]?high$/i;

/** An effort's name as a word: the agents' "xhigh" is "Extra high". */
export const effortWord = (name: string) =>
  XHIGH_RE.test(name.trim()) ? "Extra high" : name;

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

const STATE_WORDS: Record<
  PlatformAgent["state"],
  { tone: "success" | "warning" | "muted"; word: string }
> = {
  missing: { tone: "muted", word: "Not installed" },
  ready: { tone: "success", word: "Signed in" },
  "signed-out": { tone: "warning", word: "Signed out" },
};

/**
 * One agent on this computer: its mark, how it stands, where it was found, the one thing to do
 * next as a button, and the rest in its ⋯ menu.
 */
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
  const status = downloading
    ? { tone: "muted" as const, word: downloadLabel(progress) }
    : STATE_WORDS[agent.state];
  let next: ReactNode = null;
  if (agent.state === "missing" && agent.download && !downloading) {
    next = (
      <Button
        disabled={busy}
        onClick={() => change(() => setup.download(agent.id))}
        variant="secondary"
      >
        Download ({megabytes(agent.download.size)})
      </Button>
    );
  } else if (agent.state === "signed-out" && agent.signInWith) {
    next = (
      <Button
        disabled={busy}
        onClick={() => change(() => setup.signIn(agent.id))}
        variant="secondary"
      >
        Sign in with {agent.signInWith}
      </Button>
    );
  }
  return (
    <div className="flex flex-col gap-3 px-4 py-3">
      <div className="flex items-center gap-3">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted">
          <AgentIcon agentId={agent.id} className="size-4.5" />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div className="flex items-center gap-2.5">
            <span className="font-body-semibold">{agent.name}</span>
            <Status tone={status.tone}>{status.word}</Status>
          </div>
          <div className="font-body-small text-muted-foreground">
            {agent.executable ? (
              <CutText className="block truncate">{foundAt(agent)}</CutText>
            ) : null}
            {agent.detail ? (
              <span className="block">{agent.detail}</span>
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
          </div>
        </div>
        {next}
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <IconButton disabled={busy} tooltip={`More for ${agent.name}`} />
            }
          >
            <Ellipsis />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              onClick={() => change(() => setup.choosePath(agent.id))}
            >
              Choose the executable…
            </DropdownMenuItem>
            {agent.customPath ? (
              <DropdownMenuItem
                onClick={() => change(() => setup.clearPath(agent.id))}
              >
                Use the one on your PATH
              </DropdownMenuItem>
            ) : null}
            {agent.apiKey ? (
              <DropdownMenuItem
                onClick={() => change(() => setup.setApiKey(agent.id, null))}
              >
                Forget the API key
              </DropdownMenuItem>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {progress?.phase === "failed" ? (
        <RowMessage kind="error">
          <p>The download failed: {progress.message}</p>
        </RowMessage>
      ) : null}
      {offersKey ? (
        <div className="flex flex-col gap-1.5 pl-11">
          <span className="font-body-small text-muted-foreground">
            Or sign in with an API key, kept in your system’s keychain.
          </span>
          <ApiKeyField
            busy={busy}
            onSave={(key) => change(() => setup.setApiKey(agent.id, key))}
          />
        </div>
      ) : null}
    </div>
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
    if (setup) {
      useMachineAgents.getState().load().catch(reportError);
    }
  }, [setup]);
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
    return <ServerAgents />;
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
    <section data-setting="machine-agents">
      <Group>
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
    </section>
  );
};

/**
 * In a browser there is no app to install or sign in agents: the server starts those it finds
 * on its computer, and says how to install one.
 */
const ServerAgents = () => {
  const agents = useAgents((s) => s.agents);
  useEffect(() => {
    useAgents.getState().load();
  }, []);
  return (
    <section data-setting="machine-agents">
      <Group note="The agents Ultrapaint starts on this computer. Install or sign in to one in a terminal, then start a new chat.">
        {agents.map((agent) => (
          <div className="flex items-center gap-3 px-4 py-3" key={agent.id}>
            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted">
              <AgentIcon agentId={agent.id} className="size-4.5" />
            </span>
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="font-body-semibold">{agent.name}</span>
              <span className="truncate font-body-small text-muted-foreground">
                {agent.package ? (
                  <>
                    <code className="font-code">{agent.package}</code>, run with
                    npx when it isn’t installed
                  </>
                ) : (
                  <code className="font-code">{agent.command}</code>
                )}
              </span>
            </div>
          </div>
        ))}
      </Group>
    </section>
  );
};
