#!/usr/bin/env node
/**
 * Stands in for the server in the app's tests. `FAKE_SERVER` picks what it does:
 *
 *   ready   prints a log line, then a ready line, and stays until it is stopped
 *   silent  says why on stderr and exits without a ready line
 *   chatty  as `ready`, then writes more on stdout than a pipe holds; its `/api/health` answers
 *           once all of it was read, with one agent at work
 *
 * It writes its pid and the flags it was given to `FAKE_SERVER_RECORD`, when set.
 */
import { writeFileSync } from "node:fs";
import { createServer } from "node:http";

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

const token = "fake-token";
let port = 4999;
/** Done once what was written after the ready line was read. */
let read = Promise.resolve();
if (process.env.FAKE_SERVER === "chatty") {
  const server = createServer(async (_request, response) => {
    await read;
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ ok: true, token, working: 1 }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  ({ port } = server.address());
}

console.log("a log line a dependency printed");
console.log(
  JSON.stringify({
    pid: process.pid,
    port,
    token,
    url: `http://127.0.0.1:${port}`,
  })
);
if (process.env.FAKE_SERVER === "chatty") {
  read = new Promise((resolve) =>
    process.stdout.write(
      "a line after the ready line\n".repeat(40_000),
      resolve
    )
  );
}
setInterval(() => undefined, 1000);
