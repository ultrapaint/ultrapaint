import { describe, expect, it } from "@effect/vitest";
import {
  type AgentLaunch,
  bubblewrapArgs,
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

const DARWIN = { platform: "darwin" };
const LINUX = { bubblewrap: "/usr/bin/bwrap", platform: "linux" };

describe("bubblewrapArgs", () => {
  const args = bubblewrapArgs(policy).join(" ");

  it("blanks the home directory before anything is bound back over it", () => {
    const tmpfs = args.indexOf(`--tmpfs ${policy.home}`);
    const rebound = args.indexOf(`--ro-bind-try ${policy.reads[0]}`);
    expect(tmpfs).toBeGreaterThan(-1);
    // Later binds cover earlier ones: the toolchain has to come after the blanking.
    expect(rebound).toBeGreaterThan(tmpfs);
  });

  it("binds the repository writable and the toolchain read-only", () => {
    expect(args).toContain(`--bind-try ${policy.root} ${policy.root}`);
    expect(args).toContain(
      `--ro-bind-try ${policy.reads[0]} ${policy.reads[0]}`
    );
    expect(args).not.toContain(`--bind-try ${policy.reads[0]}`);
  });

  it("ends the sandbox with the server that started it", () => {
    expect(args).toContain("--die-with-parent");
  });
});

describe("sandboxLaunch", () => {
  it("starts the agent through sandbox-exec with its own temp directory", () => {
    const wrapped = sandboxLaunch(launch, policy, DARWIN);
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

  it("starts the agent through bubblewrap on Linux", () => {
    const wrapped = sandboxLaunch(launch, policy, LINUX);
    expect(wrapped.command).toBe("/usr/bin/bwrap");
    expect(wrapped.args.slice(-3)).toEqual([
      "npx",
      "-y",
      "@agentclientprotocol/claude-agent-acp",
    ]);
    expect(wrapped.env).toEqual({ FOO: "bar", TMPDIR: policy.tmpDir });
  });

  it("leaves the launch alone where there is no sandbox", () => {
    const noBwrap = { platform: "linux" };
    expect(sandboxLaunch(launch, policy, noBwrap)).toEqual(launch);
    expect(sandboxAvailable(noBwrap)).toBe(false);
    expect(sandboxAvailable({ platform: "win32" })).toBe(false);
    expect(sandboxAvailable(LINUX)).toBe(true);
    expect(sandboxAvailable(DARWIN)).toBe(true);
  });
});
