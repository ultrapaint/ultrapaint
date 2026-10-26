#!/usr/bin/env node
/**
 * Stands in for the server in the app's tests. `FAKE_SERVER` picks what it does:
 *
 *   ready   prints a log line, then a ready line, and stays until it is stopped
 *   silent  says why on stderr and exits without a ready line
 *
 * It writes its pid and the flags it was given to `FAKE_SERVER_RECORD`, when set.
 */
import { writeFileSync } from "node:fs";

if (process.env.FAKE_SERVER_RECORD) {
  writeFileSync(
    process.env.FAKE_SERVER_RECORD,
    JSON.stringify({
      args: process.argv.slice(2),
      cwd: process.cwd(),
      env: {
        ELECTRON_RUN_AS_NODE: process.env.ELECTRON_RUN_AS_NODE,
        ULTRAPAINT_HOME: process.env.ULTRAPAINT_HOME,
      },
      pid: process.pid,
    })
  );
}

if (process.env.FAKE_SERVER === "silent") {
  console.error("Error: something the server could not get past");
  process.exit(1);
}

console.log("a log line a dependency printed");
console.log(
  JSON.stringify({
    pid: process.pid,
    port: 4999,
    token: "fake-token",
    url: "http://127.0.0.1:4999",
  })
);
setInterval(() => undefined, 1000);
