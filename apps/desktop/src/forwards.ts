/**
 * The ports of a remote project forwarded here (PLAN-desktop D12): the server's, for as long as
 * the project is open, and the preview's, which starts later than the server and moves to
 * another port when it starts again. The editor names the preview by its address on the remote
 * machine; the window reaches it through the forward, at the same path and query.
 */

/** A port of the remote machine and the port here it is forwarded to. */
export interface PortForward {
  readonly local: number;
  /** As the remote machine reaches it: `127.0.0.1`. */
  readonly remoteHost: string;
  readonly remotePort: number;
}

export interface Forwards {
  /** The preview's, once the editor asked for it; the one it asked for last. */
  readonly preview?: PortForward | undefined;
  readonly server: PortForward;
}

const TRAILING_SLASH_RE = /\/$/;

/** The names the remote server gives what listens on its loopback. */
const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]"]);

/** The port of the remote machine a URL names on its loopback, if it names one. */
export const remotePortOf = (url: string) => {
  if (!URL.canParse(url)) {
    return;
  }
  const parsed = new URL(url);
  if (parsed.protocol !== "http:" || !LOOPBACK.has(parsed.hostname)) {
    return;
  }
  return Number(parsed.port || 80);
};

/** The forward of a remote port, the server's or the preview's. */
export const forwardOf = (forwards: Forwards, remotePort: number) =>
  [forwards.server, forwards.preview].find(
    (forward) => forward?.remotePort === remotePort
  );

/** `url` with its origin the forward's here, its path, query and hash as they were. */
export const throughForward = (url: string, forward: PortForward) => {
  const mapped = new URL(url);
  mapped.hostname = "127.0.0.1";
  mapped.port = String(forward.local);
  // An origin stays one: the editor adds its paths to it.
  return mapped.href.replace(TRAILING_SLASH_RE, url.endsWith("/") ? "/" : "");
};

/**
 * The preview at another port: its forward in place of the one before, which is cancelled
 * unless it is the server's own.
 */
export const movePreview = (
  forwards: Forwards,
  preview: PortForward
): { readonly cancel: readonly PortForward[]; readonly next: Forwards } => {
  const before = forwards.preview;
  const cancel =
    before &&
    before.remotePort !== preview.remotePort &&
    before.remotePort !== forwards.server.remotePort
      ? [before]
      : [];
  return { cancel, next: { ...forwards, preview } };
};
