/**
 * What an agent said of itself in `initialize`, read once, and every decision the editor takes
 * by it: how a stored session is opened again, what a prompt may carry, whether the editor's MCP
 * server can be reached, how the agent signs in. Pure: the live session keeps it, and nothing
 * else reads the agent's capabilities.
 */
import type {
  AuthMethod,
  ContentBlock,
  InitializeResponse,
} from "@agentclientprotocol/sdk";

/** One way the agent signs in, as it says: `agent` through ACP's `authenticate`, `terminal` by
 * the user running the agent themselves. */
export interface SignInMethod {
  readonly description?: string;
  readonly id: string;
  readonly kind: "agent" | "terminal";
  readonly name: string;
}

export interface Negotiated {
  /** Whether the editor's MCP server, which speaks streamable HTTP, can be given to it. */
  readonly mcpHttp: boolean;
  /** What a prompt may carry beyond text and links to files. */
  readonly prompt: {
    readonly audio: boolean;
    readonly embeddedContext: boolean;
    readonly image: boolean;
  };
  /** How a stored session is opened again: without replay, replayed, or not at all. */
  readonly reopen: "resume" | "load" | null;
  /** The ways it signs in, which the editor tells the user and never picks for them. */
  readonly signIn: readonly SignInMethod[];
}

const signInOf = (method: AuthMethod): SignInMethod => ({
  id: method.id,
  kind: "type" in method && method.type === "terminal" ? "terminal" : "agent",
  name: method.name,
  ...(method.description ? { description: method.description } : {}),
});

export const negotiated = (init: InitializeResponse): Negotiated => {
  const capabilities = init.agentCapabilities;
  const prompt = capabilities?.promptCapabilities;
  let reopen: Negotiated["reopen"] = null;
  if (capabilities?.sessionCapabilities?.resume) {
    reopen = "resume";
  } else if (capabilities?.loadSession === true) {
    reopen = "load";
  }
  return {
    mcpHttp: capabilities?.mcpCapabilities?.http === true,
    prompt: {
      audio: prompt?.audio === true,
      embeddedContext: prompt?.embeddedContext === true,
      image: prompt?.image === true,
    },
    reopen,
    signIn: (init.authMethods ?? []).map(signInOf),
  };
};

/** Before `initialize`: an agent that has said nothing can be asked for nothing beyond the baseline. */
export const BASELINE: Negotiated = negotiated({ protocolVersion: 1 });

/**
 * A prompt's block as the agent can take it: a file embedded becomes a link to it where the
 * agent takes no embedded context, and a picture or a recording a line saying what it was where
 * it takes none. Text and links every agent takes.
 */
export const promptBlock = (
  agent: Negotiated,
  block: ContentBlock
): ContentBlock => {
  switch (block.type) {
    case "resource":
      if (agent.prompt.embeddedContext) {
        return block;
      }
      return {
        name: block.resource.uri.split("/").at(-1) ?? block.resource.uri,
        type: "resource_link",
        uri: block.resource.uri,
      };
    case "image":
      return agent.prompt.image
        ? block
        : {
            text: "[A picture was attached, which this agent cannot see.]",
            type: "text",
          };
    case "audio":
      return agent.prompt.audio
        ? block
        : {
            text: "[A recording was attached, which this agent cannot hear.]",
            type: "text",
          };
    default:
      return block;
  }
};

/** The code ACP gives "authentication required": the agent must be signed in first. */
export const AUTH_REQUIRED = -32_000;
