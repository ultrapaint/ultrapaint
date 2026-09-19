import { describe, expect, it } from "@effect/vitest";
import {
  type AgentLaunch,
  sandboxAvailable,
  sandboxLaunch,
  seatbeltProfile,
} from "./sandbox.ts";

const policy = {
  agentDirs: ["/Users/me/.claude", "/tmp/claude-501"],
  home: "/Users/me",
  reads: ["/Users/me/.nvm", "/Users/me/.gitconfig"],
  root: "/Users/me/code/app",
  scratch: ["/Users/me/.npm", "/tmp"],
  tmpDir: "/var/folders/x/agent",
};

const launch: AgentLaunch = {
  args: ["-y", "@agentclientprotocol/claude-agent-acp"],
  command: "npx",
  env: { FOO: "bar" },
};

describe("seatbeltProfile", () => {
  const profile = seatbeltProfile(policy);

  it("closes the home directory to reads and everything to writes", () => {
    expect(profile).toContain('(deny file-read-data (subpath "/Users/me"))');
    expect(profile).toContain('(deny file-write* (subpath "/"))');
  });

  it("opens the repository, the agent's own directories and the toolchain", () => {
    const [reads] = profile
      .split("\n")
      .filter((line) => line.startsWith("(allow file-read-data"));
    for (const allowed of [
      policy.root,
      policy.tmpDir,
      ...policy.agentDirs,
      ...policy.scratch,
      ...policy.reads,
    ]) {
      expect(reads).toContain(`(subpath "${allowed}")`);
    }
  });

  it("allows writing only the repository, the agent's directories and its temp dir", () => {
    const [writes] = profile
      .split("\n")
      .filter((line) => line.startsWith("(allow file-write*"));
    expect(writes).toContain(`(subpath "${policy.root}")`);
    expect(writes).toContain(`(subpath "${policy.tmpDir}")`);
    expect(writes).toContain('(subpath "/Users/me/.claude")');
    // An agent started through `npx` unpacks itself into the npm cache.
    expect(writes).toContain('(subpath "/Users/me/.npm")');
    // Read-only paths stay read-only.
    expect(writes).not.toContain('(subpath "/Users/me/.nvm")');
  });
});

describe("sandboxLaunch", () => {
  it("starts the agent through sandbox-exec with its own temp directory", () => {
    const wrapped = sandboxLaunch(launch, policy, "darwin");
    expect(wrapped.command).toBe("/usr/bin/sandbox-exec");
    expect(wrapped.args.slice(-3)).toEqual([
      "npx",
      "-y",
      "@agentclientprotocol/claude-agent-acp",
    ]);
    expect(wrapped.args[0]).toBe("-p");
    expect(wrapped.args[1]).toBe(seatbeltProfile(policy));
    expect(wrapped.env).toEqual({ FOO: "bar", TMPDIR: policy.tmpDir });
  });

  it("leaves the launch alone where there is no sandbox", () => {
    expect(sandboxLaunch(launch, policy, "linux")).toEqual(launch);
    expect(sandboxAvailable("linux")).toBe(false);
    expect(sandboxAvailable("darwin")).toBe(true);
  });
});
