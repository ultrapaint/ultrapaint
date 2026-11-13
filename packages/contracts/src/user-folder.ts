/**
 * Where the person's folder (`.ultrapaint`) is once it was moved out of their home folder (ADR
 * 0091): a small file in the system's per-user configuration folder, written by the desktop app
 * when it moves the folder and read by every server and `ultrapaint mcp` that is given no
 * `--user-dir` or `ULTRAPAINT_USER_DIR`, so an agent outside the app finds it too.
 */
import { Schema } from "effect";

export const UserFolderLocation = Schema.Struct({
  /** The folder the person's folder is in, absolute. */
  userDirIn: Schema.String,
  version: Schema.Literal(1),
});
export type UserFolderLocation = typeof UserFolderLocation.Type;

/** The location file's text as JSON, read and written alike. */
export const UserFolderLocationJson = Schema.fromJsonString(UserFolderLocation);

/** What tells the per-user configuration folder apart on each system. */
export interface Machine {
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly home: string;
  readonly platform: string;
}

/**
 * The system's per-user configuration folder: `%APPDATA%` on Windows, `~/Library/Application
 * Support` on macOS, `$XDG_CONFIG_HOME` or `~/.config` elsewhere.
 */
const configFolder = ({ env, home, platform }: Machine) => {
  if (platform === "win32") {
    return env.APPDATA || `${home}/AppData/Roaming`;
  }
  if (platform === "darwin") {
    return `${home}/Library/Application Support`;
  }
  return env.XDG_CONFIG_HOME || `${home}/.config`;
};

/** The location file: `Ultrapaint/user-folder.json` in the per-user configuration folder. */
export const userFolderLocationFile = (machine: Machine) =>
  `${configFolder(machine)}/Ultrapaint/user-folder.json`;
