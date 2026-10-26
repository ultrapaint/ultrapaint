/**
 * The hosts a remote project can be on (PLAN-desktop D12): what the user types, `alias`,
 * `user@host` or `user@host:port`, and the `Host` aliases of their SSH configuration, offered as
 * they type. The configuration is read, never written: `ssh` itself applies it.
 */
import { Effect, FileSystem, Path } from "effect";

/** A host as the dialog takes it, split into what `ssh` takes as a destination and a port. */
export interface HostInput {
  readonly host: string;
  readonly port?: number;
}

const PORT_SUFFIX_RE = /^(.+?):(\d{1,5})$/;
const BRACKETED_RE = /^(.*?)\[([^\]]+)\](?::(\d{1,5}))?$/;
const SPACE_RE = /\s/;
const LINE_RE = /\r?\n/;
const WORD_RE = /"([^"]*)"|([^\s=]+)/g;
const HOME_RE = /^~(?=\/|$)/;

/**
 * `user@host:port` split at its port; an IPv6 address in brackets keeps its colons, and one
 * without brackets is taken whole. Nothing for an empty or spaced input, which `ssh` would read
 * as several arguments, or one starting with a dash, which it would read as a flag.
 */
export const parseHostInput = (text: string): HostInput | undefined => {
  const input = text.trim();
  if (input === "" || SPACE_RE.test(input) || input.startsWith("-")) {
    return;
  }
  if (BRACKETED_RE.test(input)) {
    const [, user = "", address = "", port] = input.split(BRACKETED_RE);
    return withPort(`${user}${address}`, port);
  }
  if (input.split(":").length !== 2) {
    // No port, or an IPv6 address without brackets, whose colons are its own.
    return { host: input };
  }
  if (!PORT_SUFFIX_RE.test(input)) {
    return;
  }
  const [, host = "", port] = input.split(PORT_SUFFIX_RE);
  return withPort(host, port);
};

const withPort = (host: string, port: string | undefined) => {
  if (port === undefined) {
    return { host };
  }
  const number = Number(port);
  return number > 0 && number < 65_536 ? { host, port: number } : undefined;
};

/** A pattern rather than a name: `*`, `?` or a negation. */
const isPattern = (alias: string) =>
  alias.includes("*") || alias.includes("?") || alias.startsWith("!");

/** The words of a configuration line, `Key value`, `Key=value` or quoted. */
const wordsOf = (line: string) => {
  const hash = line.indexOf("#");
  const content = (hash === -1 ? line : line.slice(0, hash)).trim();
  const words: string[] = [];
  for (const match of content.matchAll(WORD_RE)) {
    words.push(match[1] ?? match[2] ?? "");
  }
  return words;
};

/** The `Host` aliases a configuration names, patterns aside, and the files it includes. */
export const parseSshConfig = (text: string) => {
  const aliases: string[] = [];
  const includes: string[] = [];
  for (const line of text.split(LINE_RE)) {
    const [key = "", ...values] = wordsOf(line);
    const directive = key.toLowerCase();
    if (directive === "host") {
      aliases.push(...values.filter((alias) => !isPattern(alias)));
    } else if (directive === "include") {
      includes.push(...values);
    }
  }
  return { aliases, includes };
};

const GLOB_SPECIAL_RE = /[.+^${}()|[\]\\]/g;

/** A file name pattern of `Include` as a regular expression: `*` and `?` only. */
const globRegExp = (pattern: string) =>
  new RegExp(
    `^${pattern
      .replace(GLOB_SPECIAL_RE, "\\$&")
      .replaceAll("*", ".*")
      .replaceAll("?", ".")}$`
  );

/**
 * The aliases in the configuration file and those it includes, sorted, each once. A file that
 * cannot be read adds nothing: the suggestions are a help, and `ssh` reports a broken file.
 */
export const readSshHosts = Effect.fnUntraced(function* (
  configFile: string,
  home: string
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const sshDir = path.join(home, ".ssh");
  const found = new Set<string>();
  const seen = new Set<string>();

  /** An `Include` argument as files: relative to `~/.ssh`, with a pattern in its last part. */
  const filesOf = (pattern: string) =>
    Effect.gen(function* () {
      const expanded = pattern.replace(HOME_RE, home);
      const absolute = path.isAbsolute(expanded)
        ? expanded
        : path.join(sshDir, expanded);
      const name = path.basename(absolute);
      if (!(name.includes("*") || name.includes("?"))) {
        return [absolute];
      }
      const dir = path.dirname(absolute);
      const matches = globRegExp(name);
      const entries = yield* fs
        .readDirectory(dir)
        .pipe(Effect.orElseSucceed(() => [] as string[]));
      return entries
        .filter((entry) => matches.test(entry))
        .sort()
        .map((entry) => path.join(dir, entry));
    });

  const visit = (file: string): Effect.Effect<void> =>
    Effect.gen(function* () {
      if (seen.has(file)) {
        return;
      }
      seen.add(file);
      const text = yield* fs
        .readFileString(file)
        .pipe(Effect.orElseSucceed(() => ""));
      const { aliases, includes } = parseSshConfig(text);
      for (const alias of aliases) {
        found.add(alias);
      }
      for (const include of includes) {
        for (const included of yield* filesOf(include)) {
          yield* visit(included);
        }
      }
    });

  yield* visit(configFile);
  return [...found].sort((a, b) => a.localeCompare(b));
});
