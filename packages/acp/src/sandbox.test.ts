import { describe, expect, it } from "@effect/vitest";
import {
  type AgentLaunch,
  agentEnv,
  bubblewrapArgs,
  outermost,
  sandboxAvailable,
  sandboxLaunch,
  seatbeltProfile,
} from "./sandbox.ts";

const policy = {
  agentDirs: ["/Users/me/.claude", "/tmp/claude-501"],
  hidden: ["/run/user/501"],
  home: "/Users/me",
  readOnly: ["/Users/me/code/app/.git"],
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

/** Whether a rule line reaches a path: by naming it, or by naming a directory above it. */
const covers = (line: string, path: string) =>
  line.includes(`(subpath ${JSON.stringify(path)})`) ||
  [...line.matchAll(/\(subpath "([^"]+)"\)/g)].some(([, allowed]) =>
    path.startsWith(`${allowed}/`)
  );

describe("seatbeltProfile", () => {
  const profile = seatbeltProfile(policy);

  it("closes the home directory to reads and everything to writes", () => {
    expect(profile).toContain('(deny file-read-data (subpath "/Users/me"))');
    expect(profile).toContain('(deny file-write* (subpath "/"))');
  });

  it("opens the repository, the agent's own directories and the toolchain", () => {
    const [reads = ""] = profile
      .split("\n")
      .filter((line) => line.startsWith("(allow file-read-data"));
    for (const allowed of [
      policy.root,
      policy.tmpDir,
      ...policy.agentDirs,
      ...policy.scratch,
      ...policy.reads,
    ]) {
      // Named, or inside something named: `/tmp/claude-501` needs no rule of its own once
      // `/tmp` has one.
      expect(covers(reads, allowed)).toBe(true);
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

  it("gives the agent its own processes, IPC and no terminal to type into", () => {
    for (const flag of ["--unshare-pid", "--unshare-ipc", "--new-session"]) {
      expect(args).toContain(flag);
    }
    // The network stays: an agent talks to its model.
    expect(args).not.toContain("--unshare-net");
    expect(args).not.toContain("--unshare-all");
  });

  it("hides the session bus and the user's runtime directory", () => {
    expect(args).toContain("--unsetenv DBUS_SESSION_BUS_ADDRESS");
    expect(args).toContain("--tmpfs /run/user/501");
  });

  it("makes the session's temporary directory its /tmp, under what is bound back", () => {
    // On Linux the server leaves the machine's /tmp out of what is writable.
    const list = bubblewrapArgs({ ...policy, scratch: ["/Users/me/.npm"] });
    const tmp = list.indexOf("/tmp");
    expect(list.slice(tmp - 2, tmp + 1)).toEqual([
      "--bind",
      policy.tmpDir,
      "/tmp",
    ]);
    // The machine's /tmp is not bound, only an agent directory that lives in it, after.
    expect(list.join(" ")).not.toContain("--bind-try /tmp /tmp");
    expect(list.indexOf("/tmp/claude-501")).toBeGreaterThan(tmp);
  });
});

describe("sandboxLaunch", () => {
  it("starts the agent through sandbox-exec with its own temp directory", () => {
    const wrapped = sandboxLaunch(launch, policy, DARWIN);
    expect(wrapped.command).toBe("/usr/bin/sandbox-exec");
    expect(wrapped.args).toEqual([
      "-p",
      seatbeltProfile(policy),
      "npx",
      "-y",
      "@agentclientprotocol/claude-agent-acp",
    ]);
    expect(wrapped.env).toEqual({ FOO: "bar", TMPDIR: policy.tmpDir });
  });

  it("starts the agent through bubblewrap on Linux", () => {
    const wrapped = sandboxLaunch(launch, policy, LINUX);
    expect(wrapped.command).toBe("/usr/bin/bwrap");
    expect(wrapped.args.slice(-7)).toEqual([
      "--setenv",
      "TMPDIR",
      "/tmp",
      "--",
      "npx",
      "-y",
      "@agentclientprotocol/claude-agent-acp",
    ]);
    // Handed on by bubblewrap, which keeps its environment for what it starts.
    expect(wrapped.env).toEqual({ FOO: "bar" });
  });

  it("puts no value of a variable on the command line, where anyone can read it", () => {
    const secret = {
      ...launch,
      env: { ANTHROPIC_API_KEY: "sk-ant-secret", FOO: "bar" },
    };
    for (const tools of [LINUX, DARWIN]) {
      const wrapped = sandboxLaunch(secret, policy, tools);
      expect(wrapped.args.join("\n")).not.toContain("sk-ant-secret");
      expect(wrapped.args.join("\n")).not.toContain("ANTHROPIC_API_KEY");
      expect(wrapped.env.ANTHROPIC_API_KEY).toBe("sk-ant-secret");
    }
  });

  it("never sets a loader variable on the process that makes the sandbox", () => {
    const preload = {
      ...launch,
      env: {
        "BAD=NAME": "x",
        DYLD_INSERT_LIBRARIES: "/tmp/x.dylib",
        GCONV_PATH: "/tmp/gconv",
        LD_PRELOAD: "/tmp/x.so",
      },
    };
    for (const tools of [LINUX, DARWIN]) {
      const wrapped = sandboxLaunch(preload, policy, tools);
      expect(Object.keys(wrapped.env).sort()).toEqual(
        tools === DARWIN ? ["TMPDIR"] : []
      );
      // Set inside the sandbox instead, on what it starts.
      expect(wrapped.args.join(" ")).toContain(
        tools === DARWIN
          ? "LD_PRELOAD=/tmp/x.so"
          : "--setenv LD_PRELOAD /tmp/x.so"
      );
      // A name that would be read as something else is not passed at all.
      expect(wrapped.args.some((arg) => arg.includes("BAD=NAME"))).toBe(false);
    }
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

describe("agentEnv", () => {
  it("drops what tells the loader what to load, and keeps the rest", () => {
    expect(
      agentEnv({
        DYLD_INSERT_LIBRARIES: "/tmp/x.dylib",
        LD_LIBRARY_PATH: "/tmp",
        LD_PRELOAD: "/tmp/x.so",
        NODE_ENV: "test",
        OLD_PWD: "/",
      })
    ).toEqual({ NODE_ENV: "test", OLD_PWD: "/" });
  });
});

describe("outermost", () => {
  it("drops a path its parent already covers", () => {
    expect(outermost(["/a/b/c", "/a", "/a/b"])).toEqual(["/a"]);
  });

  it("keeps a sibling whose name merely starts the same", () => {
    expect(outermost(["/a", "/a-b", "/ab"])).toEqual(["/a", "/a-b", "/ab"]);
  });

  it("keeps unrelated paths and says each once", () => {
    expect(outermost(["/b", "/a", "/b"])).toEqual(["/a", "/b"]);
  });
});

describe("a toolchain nested inside another allowed path", () => {
  /**
   * fnm puts a per-shell symlink on `PATH`, so the policy ends up with `~/.local` (from
   * `~/.local/bin`) and two paths underneath it. Bubblewrap cannot mount over a symlink inside a
   * mount it has already made, and failed the whole launch: the agent never started on Linux.
   */
  const fnm = {
    ...policy,
    home: "/home/naf",
    reads: [
      "/home/naf/.local",
      "/home/naf/.local/state/fnm_multishells/41288_1790097241191",
      "/home/naf/.local/share/fnm/node-versions/v24.21.0/installation",
      "/home/naf/.gitconfig",
    ],
    root: "/home/naf/code/app",
  };

  it("binds the parent alone, and never what it contains", () => {
    const args = bubblewrapArgs(fnm);
    expect(args).toContain("/home/naf/.local");
    expect(args.some((arg) => arg.includes("fnm_multishells"))).toBe(false);
    expect(args.some((arg) => arg.includes("node-versions"))).toBe(false);
    expect(args).toContain("/home/naf/.gitconfig");
  });

  it("says the same thing to Seatbelt", () => {
    const profile = seatbeltProfile(fnm);
    expect(profile).toContain('(subpath "/home/naf/.local")');
    expect(profile).not.toContain("fnm_multishells");
  });

  it("still binds a writable path that sits under a readable one", () => {
    const args = bubblewrapArgs({
      ...fnm,
      scratch: ["/home/naf/.local/share/pnpm"],
    });
    const reads = args.indexOf("/home/naf/.local");
    const writes = args.indexOf("/home/naf/.local/share/pnpm");
    expect(writes).toBeGreaterThan(reads);
    expect(args[writes - 1]).toBe("--bind-try");
  });
});

describe("the repository's .git", () => {
  it("is closed to writes in Seatbelt, by a rule after the one that opens the repository", () => {
    const lines = seatbeltProfile(policy).split("\n");
    const opens = lines.findIndex((l) => l.startsWith("(allow file-write*"));
    const closes = lines.findIndex(
      (l) =>
        l.startsWith("(deny file-write*") &&
        l.includes('(subpath "/Users/me/code/app/.git")')
    );
    expect(closes).toBeGreaterThan(opens);
  });

  it("is bound read-only over the writable repository in bubblewrap", () => {
    const args = bubblewrapArgs(policy);
    const repo = args.lastIndexOf("/Users/me/code/app");
    const git = args.indexOf("/Users/me/code/app/.git");
    expect(git).toBeGreaterThan(repo);
    expect(args[git - 1]).toBe("--ro-bind-try");
  });
});

describe("a design thread's sandbox (ADR 0030)", () => {
  const designing = {
    ...policy,
    readOnly: [policy.root],
    rewritable: [`${policy.root}/docs/designs`],
  };

  it("closes the repository to Seatbelt's writes and opens the designs again, last", () => {
    const lines = seatbeltProfile(designing).split("\n");
    const closed = lines.indexOf(
      `(deny file-write* (subpath "${policy.root}"))`
    );
    const reopened = lines.indexOf(
      `(allow file-write* (subpath "${policy.root}/docs/designs"))`
    );
    expect(closed).toBeGreaterThan(-1);
    expect(reopened).toBe(lines.length - 1);
  });

  it("binds the designs writable over bubblewrap's read-only repository", () => {
    const args = bubblewrapArgs(designing);
    const readOnly = args.findIndex(
      (a, i) => a === "--ro-bind-try" && args[i + 1] === policy.root
    );
    const writable = args.findIndex(
      (a, i) =>
        a === "--bind-try" && args[i + 1] === `${policy.root}/docs/designs`
    );
    expect(readOnly).toBeGreaterThan(-1);
    expect(writable).toBeGreaterThan(readOnly);
  });

  it("says nothing of the designs when the whole repository is writable", () => {
    expect(bubblewrapArgs(policy).join(" ")).not.toContain("docs/designs");
    expect(seatbeltProfile(policy)).not.toContain("docs/designs");
  });
});
