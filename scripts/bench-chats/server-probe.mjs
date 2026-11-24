/**
 * Loaded into the editor's server by `pnpm bench:chats` (`NODE_OPTIONS=--import`): once a
 * second, how late its event loop ran and the CPU it used, as a line of JSON in
 * `$BENCH_PROBE_DIR/server-<pid>.ndjson`. Every other process given the option ignores it.
 */
import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { monitorEventLoopDelay } from "node:perf_hooks";

const dir = process.env.BENCH_PROBE_DIR;
if (dir && process.argv[1]?.endsWith("apps/server/src/bin.ts")) {
  const file = join(dir, `server-${process.pid}.ndjson`);
  const delay = monitorEventLoopDelay({ resolution: 10 });
  delay.enable();
  let cpu = process.cpuUsage();
  setInterval(() => {
    const used = process.cpuUsage(cpu);
    cpu = process.cpuUsage();
    appendFileSync(
      file,
      `${JSON.stringify({
        cpuMs: (used.user + used.system) / 1000,
        delayMaxMs: delay.max / 1e6,
        delayMeanMs: delay.mean / 1e6,
        delayP99Ms: delay.percentile(99) / 1e6,
        t: Date.now(),
      })}\n`
    );
    delay.reset();
  }, 1000).unref();
}
