/**
 * The agents the app offers to download when one is not found (PLAN-desktop D8): a pinned
 * release of each, per platform, with the size and SHA-256 of every file, taken from the
 * vendors' own release manifests. A download that does not match is thrown away. Raising a
 * version means taking the new figures from the same places.
 *
 * - Claude Code, from Anthropic's native installer's bucket (what `claude.ai/install.sh`
 *   fetches): `<base>/<version>/manifest.zst.json` lists the compressed binary of each
 *   platform, `manifest.json` the binary itself.
 * - Codex, from the openai/codex GitHub release: the complete package of each platform (the
 *   `codex` binary with its companions), its digest as GitHub lists it. 0.160 is the line the
 *   bundled codex-acp is built against.
 */

export interface ClaudeRelease {
  readonly kind: "zst-binary";
  /** The binary, once decompressed. */
  readonly sha256: string;
  readonly size: number;
  readonly url: string;
  readonly version: string;
  /** The compressed download. */
  readonly zstSha256: string;
  readonly zstSize: number;
}

export interface CodexRelease {
  /** The executable inside the package, as its `codex-package.json` names it. */
  readonly entrypoint: string;
  readonly kind: "tar-gz-package";
  readonly sha256: string;
  readonly size: number;
  /** The package's target, which its `codex-package.json` says too. */
  readonly target: string;
  readonly url: string;
  readonly version: string;
}

export type AgentRelease = ClaudeRelease | CodexRelease;

const CLAUDE_VERSION = "2.1.308";
const claude = (
  platform: string,
  zst: readonly [string, number],
  binary: readonly [string, number]
): ClaudeRelease => ({
  kind: "zst-binary",
  sha256: binary[0],
  size: binary[1],
  url: `https://downloads.claude.ai/claude-code-releases/${CLAUDE_VERSION}/${platform}/claude.zst`,
  version: CLAUDE_VERSION,
  zstSha256: zst[0],
  zstSize: zst[1],
});

const CODEX_VERSION = "0.160.1";
const codex = (target: string, sha256: string, size: number): CodexRelease => ({
  entrypoint: "bin/codex",
  kind: "tar-gz-package",
  sha256,
  size,
  target,
  url: `https://github.com/openai/codex/releases/download/rust-v${CODEX_VERSION}/codex-package-${target}.tar.gz`,
  version: CODEX_VERSION,
});

/** By agent, then by `<platform>-<arch>` (with `-musl` for a Linux on musl). */
export const RELEASES = {
  "claude-code": {
    "darwin-arm64": claude(
      "darwin-arm64",
      [
        "e4d214226582e2f52eafa3de4b2f55469677974e49e6e96376aad740c37d2557",
        92_822_156,
      ],
      [
        "ca923c86ac84b30574a82331a05b6e066c27477a926ceaffe46a845a33e4dd37",
        274_675_680,
      ]
    ),
    "darwin-x64": claude(
      "darwin-x64",
      [
        "540f89af5ad8e2048390719961739939d59d64a0f3b01af1a158cb1be6f412ae",
        98_219_435,
      ],
      [
        "9a0bc140f5fb06e6366624d770371ef290e6731d1e84c4def5daf4df946d1b59",
        285_902_384,
      ]
    ),
    "linux-arm64": claude(
      "linux-arm64",
      [
        "6f872ce2362e3485abbd7dcb921514e3319ebe36c2efabb7193f128ed337d8d4",
        102_117_787,
      ],
      [
        "fdd22e6cbb734d580f5664c48df4294eeec850218ff07f186f9af30426396ee1",
        292_085_944,
      ]
    ),
    "linux-arm64-musl": claude(
      "linux-arm64-musl",
      [
        "855a21751041185dbd5d73386e5a9e454f0ce434a8a4b23cb2ca66add70b5427",
        100_464_884,
      ],
      [
        "b820bec20177aa09875515cf5ffadb445ecf814ec7c8ed51ba2f86c3090a692d",
        284_313_472,
      ]
    ),
    "linux-x64": claude(
      "linux-x64",
      [
        "f8b3641a8d3664420bde0153433e03fd3fad5351a1a12cf6f798ed86c52c9ea9",
        103_095_977,
      ],
      [
        "356733f185fa988e6bf3aa9a555269fdd167982a2e2a80d3c8a78037bb92ad58",
        292_232_560,
      ]
    ),
    "linux-x64-musl": claude(
      "linux-x64-musl",
      [
        "0c66f9a325b6c5c308272fd087c0f0994e6ebc081e64a4a51fcbcfbbfb484c37",
        101_509_546,
      ],
      [
        "45cc10091e10ca658daa691e879058ba1d4752218c63577d1c7d54b0c7dc9a68",
        285_896_848,
      ]
    ),
  },
  codex: {
    "darwin-arm64": codex(
      "aarch64-apple-darwin",
      "f73527ee09c6db869acbb37b709866b339ea74ef91d2de255e9c74ec960c6314",
      129_977_637
    ),
    "darwin-x64": codex(
      "x86_64-apple-darwin",
      "a98f330c9b1652cef2edc7bc2ee4c47a0fe19fa098b686381be3c8842abf0ac0",
      141_316_108
    ),
    // Codex builds Linux on musl only, statically: one package runs on glibc and musl alike.
    "linux-arm64": codex(
      "aarch64-unknown-linux-musl",
      "dff0954438fa455c2197ddb1f421d8d68625d98de610f76bedb6e5bc837ea35b",
      150_931_915
    ),
    "linux-arm64-musl": codex(
      "aarch64-unknown-linux-musl",
      "dff0954438fa455c2197ddb1f421d8d68625d98de610f76bedb6e5bc837ea35b",
      150_931_915
    ),
    "linux-x64": codex(
      "x86_64-unknown-linux-musl",
      "340801565906a7028f6baaa9ab6853addaef221f0016a1417a7c1ffdd96c21f0",
      160_785_122
    ),
    "linux-x64-musl": codex(
      "x86_64-unknown-linux-musl",
      "340801565906a7028f6baaa9ab6853addaef221f0016a1417a7c1ffdd96c21f0",
      160_785_122
    ),
  },
} as const satisfies Record<string, Record<string, AgentRelease>>;

/** Whether this Linux runs on musl rather than glibc: Node says which C library it was built on. */
export const isMusl = () => {
  const report = process.report?.getReport() as
    | { readonly header?: { readonly glibcVersionRuntime?: string } }
    | undefined;
  return process.platform === "linux" && !report?.header?.glibcVersionRuntime;
};

/** This machine's key in the release tables. */
export const platformKey = (
  platform: string = process.platform,
  arch: string = process.arch,
  musl: boolean = isMusl()
) => `${platform}-${arch}${musl ? "-musl" : ""}`;

/** The release of `agent` for this machine, when there is one. */
export const releaseFor = (
  agent: keyof typeof RELEASES,
  key: string = platformKey()
): AgentRelease | undefined =>
  (RELEASES[agent] as Readonly<Record<string, AgentRelease>>)[key];
