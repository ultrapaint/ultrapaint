#!/usr/bin/env node
/**
 * Stands in for the server on the remote machine in the app's SSH tests, run through a real
 * `ssh` to a throwaway `sshd`. It takes the flags the app gives the server, answers
 * `/api/health` with its token and `preview` (a second port it listens on, as the preview does),
 * prints its ready line, and stops when stdin closes (`--stop-with-stdin`). A run file in the
 * session directory makes the next start attach to it, as the server's own does.
 *
 * It writes what it was given to `record.json` in the session directory, and appends `stopped`
 * to `events` there when it stops.
 */
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import path from "node:path";

const args = process.argv.slice(2);
const sessionDir = args[args.indexOf("--session-dir") + 1];
mkdirSync(sessionDir, { recursive: true });
const runFile = path.join(sessionDir, "run.json");
const events = path.join(sessionDir, "events");

const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

if (existsSync(runFile)) {
  const running = JSON.parse(readFileSync(runFile, "utf8"));
  if (alive(running.pid)) {
    console.log(JSON.stringify({ ...running, attached: true }));
    process.exit(0);
  }
}

writeFileSync(
  path.join(sessionDir, "record.json"),
  JSON.stringify({
    args,
    cwd: process.cwd(),
    env: Object.keys(process.env).filter((name) =>
      name.startsWith("ULTRAPAINT_")
    ),
    pid: process.pid,
  })
);

const token = `token-${process.pid}`;
const preview = createServer((_request, response) => {
  response.end("the preview");
});
await new Promise((resolve) => preview.listen(0, "127.0.0.1", resolve));
const previewUrl = `http://127.0.0.1:${preview.address().port}`;

const server = createServer((request, response) => {
  response.setHeader("content-type", "application/json");
  if (request.url === "/api/health") {
    response.end(
      JSON.stringify({ ok: true, preview: previewUrl, token, working: 0 })
    );
    return;
  }
  response.end(JSON.stringify({ path: request.url }));
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const { port } = server.address();
const ready = {
  pid: process.pid,
  port,
  token,
  url: `http://127.0.0.1:${port}`,
};
writeFileSync(runFile, JSON.stringify(ready));
console.error("a log line on stderr");
console.log(JSON.stringify(ready));

const stop = () => {
  appendFileSync(events, `stopped ${process.pid}\n`);
  rmSync(runFile, { force: true });
  process.exit(0);
};
if (args.includes("--stop-with-stdin")) {
  process.stdin.on("end", stop);
  process.stdin.on("close", stop);
  process.stdin.resume();
}
process.on("SIGTERM", stop);
