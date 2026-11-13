/**
 * The `ultrapaint` command's launchers (ADR 0083): `sh` scripts that run the app's own server
 * bundle with Electron's binary as Node. Free of Effect, so the build script writes the one the
 * macOS app ships (`scripts/dist.ts`) from the same lines as the one the app installs.
 *
 * - The one the app writes (`launcherScript`) names the app by absolute paths, where it was when
 *   the person installed the command.
 * - The one the macOS app ships (`shippedLauncherScript`), in `Contents/Resources/bin`, finds the
 *   app from where it is: Homebrew links it onto the PATH (ADR 0088), and the link follows the
 *   app through its updates, which put the new bundle where the old one was (ADR 0078).
 */

/** Says the launcher is this app's: a second install writes over it, another is left alone. */
export const MARK =
  "# The ultrapaint command of the Ultrapaint app (ADR 0083).";
export const NAME = "ultrapaint";
/** Says the launcher is the one the app ships, which a link on the PATH (Homebrew's) leads to. */
export const SHIPPED =
  "# Shipped in the app, where Homebrew links it (ADR 0088): it finds the app from where it is.";

/** Where the app's server is, as the launcher the app writes runs it. */
export type CommandApp =
  | {
      readonly _tag: "Bundle";
      /** Electron's binary, run as Node. */
      readonly executable: string;
      readonly serverBin: string;
      readonly webDist: string;
    }
  | {
      readonly _tag: "AppImage";
      readonly appImage: string;
      /** The server's bundle and the editor's build, from the mount's root. */
      readonly serverBin: string;
      readonly webDist: string;
    };

/** A path inside single quotes for `sh`. */
export const quoted = (text: string) => `'${text.replaceAll("'", `'\\''`)}'`;

/** What a launcher says when the app it runs is no longer there. */
const gone = (app: string, again: string) => `if [ ! -x ${app} ]; then
  echo "Ultrapaint has moved or been removed: ${again}" >&2
  exit 127
fi`;

/**
 * The launcher the app writes: the server's bundle run as Node, the editor's build for it to
 * serve, and the launcher itself as the way `ultrapaint mcp` starts a project's server
 * (`ULTRAPAINT_SERVE`).
 */
export const launcherScript = (app: CommandApp, at: string) => {
  const serve = quoted(JSON.stringify([at]));
  const again =
    "open it and install the command again from Settings › Agents › Connect over MCP.";
  if (app._tag === "Bundle") {
    return `#!/bin/sh
${MARK}
${gone(quoted(app.executable), again)}
export ELECTRON_RUN_AS_NODE=1
export ULTRAPAINT_WEB_DIST=${quoted(app.webDist)}
export ULTRAPAINT_SERVE=${serve}
exec ${quoted(app.executable)} ${quoted(app.serverBin)} "$@"
`;
  }
  // Node's -e leaves the arguments after the code where a script's would be, from argv[1]: the
  // server's own name goes back in front of them.
  const start = `process.argv.splice(1, 0, ${JSON.stringify(NAME)}); process.env.ULTRAPAINT_WEB_DIST = process.env.APPDIR + ${JSON.stringify(`/${app.webDist}`)}; import(process.env.APPDIR + ${JSON.stringify(`/${app.serverBin}`)});`;
  return `#!/bin/sh
${MARK}
${gone(quoted(app.appImage), again)}
export ELECTRON_RUN_AS_NODE=1
export ULTRAPAINT_SERVE=${serve}
exec ${quoted(app.appImage)} -e ${quoted(start)} "$@"
`;
};

/**
 * The launcher the macOS app ships at `Contents/Resources/bin/ultrapaint`. It follows the links
 * that lead to it (`readlink` one at a time: `readlink -f` is in macOS from 12.3 only), then
 * takes the app's executable from `Contents/MacOS`, the server and the editor from
 * `Contents/Resources/app`, and itself, in the bundle, as the way to start a server.
 */
export const shippedLauncherScript = (executableName: string) => `#!/bin/sh
${MARK}
${SHIPPED}
self=$0
case $self in */*) ;; *) self=./$self ;; esac
while [ -L "$self" ]; do
  link=$(readlink "$self")
  case $link in
    /*) self=$link ;;
    *) self=\${self%/*}/$link ;;
  esac
done
bin=$(cd "\${self%/*}" && pwd -P) || exit 1
resources=\${bin%/*}
contents=\${resources%/*}
app="$contents/MacOS/"${quoted(executableName)}
${gone('"$app"', "install it again.")}
export ELECTRON_RUN_AS_NODE=1
export ULTRAPAINT_WEB_DIST="$resources/app/web"
serve=$(printf '%s' "$bin/${NAME}" | sed 's/[\\\\"]/\\\\&/g')
export ULTRAPAINT_SERVE="[\\"$serve\\"]"
exec "$app" "$resources/app/server/bin.mjs" "$@"
`;
