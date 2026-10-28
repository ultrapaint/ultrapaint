/**
 * How the script that serves the preview says where it listens. The server runs it with the
 * host to listen on and no port: the script binds one the system gives, then prints
 * `servingLine(port)` on a line of its own on stdout, which is its ready signal; the server reads
 * the port back with `servingPort`. No port is picked beforehand and let go of, so nothing else
 * can take it before the preview listens.
 */

const PREFIX = "[ultrapaint] serving on port ";

/** The line the serve script prints once it listens on `port`. */
export const servingLine = (port: number): string => `${PREFIX}${port}`;

/** The port a line of the serve script's output says it listens on; null for any other line. */
export const servingPort = (line: string): number | null => {
  const text = line.trim();
  if (!text.startsWith(PREFIX)) {
    return null;
  }
  const port = Number(text.slice(PREFIX.length));
  return Number.isInteger(port) && port > 0 && port < 65_536 ? port : null;
};
