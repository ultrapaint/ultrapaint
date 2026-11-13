/**
 * `pnpm dev`'s ports (ADR 0089): a pair in 4600–4679, below the installed command's 4770 and
 * 4771 so `pnpm dev` and `ultrapaint` run side by side. The pair comes from the checkout's path,
 * so each worktree finds the same one run after run; when it is taken, the next free pair.
 */
import { createHash } from "node:crypto";
import { createServer } from "node:net";

export const FIRST_PORT = 4600;
/** Pairs in 4600–4679. */
export const PAIRS = 40;

/** The server's port of the pair the checkout at `root` starts from; the editor's is the next. */
export const pathPort = (root: string) => {
  const hash = createHash("sha1").update(root).digest();
  return FIRST_PORT + ((hash[0] as number) % PAIRS) * 2;
};

/**
 * The first pair from `start` on, going round 4600–4679, whose two ports are free; `start` itself
 * when none is, so that the server says the port is taken. Every port is asked at once.
 */
export const freePair = async (
  start: number,
  isFree: (port: number) => Promise<boolean>
) => {
  const from = (start - FIRST_PORT) / 2;
  const pairs = Array.from(
    { length: PAIRS },
    (_, step) => FIRST_PORT + ((from + step) % PAIRS) * 2
  );
  const free = await Promise.all(
    pairs.map(async (port) => (await isFree(port)) && (await isFree(port + 1)))
  );
  return pairs[free.indexOf(true)] ?? start;
};

/** Whether `port` can be listened on at `host` now, where the server and Vite will listen. */
export const canListen = (host: string) => (port: number) =>
  new Promise<boolean>((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(false));
    server.listen({ exclusive: true, host, port }, () =>
      server.close(() => resolve(true))
    );
  });
