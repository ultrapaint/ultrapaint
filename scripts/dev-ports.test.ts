/** `pnpm dev`'s ports (ADR 0089). Run with Node's own runner. */
import assert from "node:assert/strict";
import { createServer } from "node:net";
import { test } from "node:test";
import {
  canListen,
  FIRST_PORT,
  freePair,
  PAIRS,
  pathPort,
} from "./dev-ports.ts";

const takenOf = (taken: readonly number[]) => (port: number) =>
  Promise.resolve(!taken.includes(port));

test("a checkout's path gives the same even port in 4600–4679 every time", () => {
  const port = pathPort("/home/me/.t3/worktrees/ultrapaint/t3-a");
  assert.equal(port, pathPort("/home/me/.t3/worktrees/ultrapaint/t3-a"));
  assert.equal(port % 2, 0);
  assert.ok(port >= FIRST_PORT && port + 1 < FIRST_PORT + PAIRS * 2);
});

test("the path's pair is kept while both its ports are free", async () => {
  assert.equal(await freePair(4620, takenOf([4618, 4623])), 4620);
});

test("a pair with either port taken moves to the next free pair", async () => {
  assert.equal(await freePair(4620, takenOf([4620])), 4622);
  assert.equal(await freePair(4620, takenOf([4621, 4622])), 4624);
});

test("past 4679 the search goes round to 4600", async () => {
  assert.equal(await freePair(4678, takenOf([4679])), 4600);
});

test("with every pair taken, the path's pair is kept for the server to say so", async () => {
  assert.equal(await freePair(4630, () => Promise.resolve(false)), 4630);
});

test("a port something listens on cannot be listened on", async () => {
  const server = createServer();
  const port = await new Promise<number>((resolve) =>
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve(typeof address === "object" && address ? address.port : 0);
    })
  );
  try {
    assert.equal(await canListen("127.0.0.1")(port), false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
  assert.equal(await canListen("127.0.0.1")(port), true);
});
