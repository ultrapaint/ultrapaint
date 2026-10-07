/**
 * The settings of the agents: the MCP connection they reach the editor by, the skills they are
 * given, the key that sends a prompt, and what a new chat starts with.
 */
import type { CustomiseMode, Skill } from "@ultrapaint/contracts/skills";
import {
  type AgentConfig,
  type AgentOptions,
  type ChatDefaults,
  isModelOption,
  type McpConnection,
  namedChoices,
} from "@ultrapaint/contracts/threads";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Markdown } from "../components/markdown.tsx";
import { OptionSelect } from "../components/option-select.tsx";
import { api } from "../state/connection.ts";
import { reportError } from "../state/project.ts";
import { type SendKey, useSendKey } from "../state/send-key.ts";
import { useSkills } from "../state/skills.ts";
import { Group, Row } from "./settings-group.tsx";

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
  disabled,
  onToggle,
}: {
  disabled: readonly string[];
  onToggle: (name: string, enabled: boolean) => void;
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
  const off = new Set(disabled);
  return (
    <Group
      description={`Told to every agent before it designs, ahead of DESIGN.md. A file in ${dir} with a built-in's name replaces it, or extends it when the file opens with the front matter "extends: true"; a file with any other name is a skill of its own. A switch turned off is saved with the settings.`}
      title="Design skills"
    >
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
  const [agents, setAgents] = useState<readonly AgentConfig[]>([]);
  const [known, setKnown] = useState<readonly AgentOptions[]>([]);
  const [defaults, setDefaults] = useState<ChatDefaults | null>(null);
  /** Why the chosen agent could not list its models, once it has been asked. */
  const [unlisted, setUnlisted] = useState<Record<string, string>>({});
  useEffect(() => {
    Promise.all([
      api().request("agents.list", undefined),
      api().request("agents.options", undefined),
      api().request("chat.defaults", undefined),
    ])
      .then(([configs, options, stored]) => {
        setAgents(configs);
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
          options={agents.map((a) => ({ label: a.name, value: a.id }))}
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
