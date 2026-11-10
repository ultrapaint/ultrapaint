# Testing

How tests are written in this repository so that they pass or fail for one reason only: the
behaviour they describe. The rules come from what studies of flaky tests found, applied to the
tools this repository already has (`@effect/vitest`, `TestClock`, `ProjectTest`, `callTool`, the
scripted agent, `fakeApi`, happy-dom).

## What makes a test flaky

Studies of fixed flaky tests agree on the causes, in this order:

- **Async wait** (about 45% in Luo et al., FSE 2014; the largest class at Mozilla too): a test
  waits for something by sleeping, and the sleep is sometimes too short. A third of them used a
  plain time delay to enforce an order.
- **Concurrency** (about 20%): two things run at once and the test assumed an order between them,
  or shared mutable state between them.
- **Test order dependency** (about 12%): a test passes only after, or only without, another one
  (a "victim" of a "polluter" that leaves state behind: module state, a store, a file, a fake
  timer).
- Then time and the clock, randomness, the network and the environment, and iteration order of
  unordered collections.

Google's experience is the same from the other side: hermetic tests, which reach nothing outside
what they build, are the ones that stay green, and retrying a failing test only hides which of
the above it is.

Sources: Luo, Hariri, Eloussi, Marinov, "An Empirical Analysis of Flaky Tests" (FSE 2014);
Gruber et al., "An Empirical Study of Flaky Tests in Python" (ICST 2021,
<https://arxiv.org/abs/2101.09077>); Hashemi, Tahir, Rasheed, "An Empirical Study of Flaky Tests
in JavaScript" (ICSME 2022, <https://arxiv.org/abs/2207.01047>); Parry et al., "Test Flakiness'
Causes, Detection, Impact and Responses: A Multivocal Review" (<https://arxiv.org/abs/2212.00908>);
Google Testing Blog, "Flaky Tests at Google and How We Mitigate Them" (2016) and "Where do our
flaky tests come from?" (2017); "How we use Hermetic Ephemeral Test Environments at Google to
reduce Test Flakiness" (ICST 2023).

## The rules

### 1. Test through the module's interface

The interface is the test surface (see `.agents/skills/codebase-design`). A test calls what a
caller calls and asserts what a caller can observe: a return value, an event published, a file
written, a document as `DocumentService` gives it back. It does not reach into a module's private
state, and it does not need to change when the implementation does. When a module is deepened,
the tests on the shallow modules it absorbed are deleted, not kept beside the new ones.

Pick the narrowest level that crosses the behaviour:

| Level | What it is | Use it for |
|---|---|---|
| Pure | a function of `contracts`, `design-document`, `system-components`, a codec | rules, formats, operations |
| Module | a service on its layer, with the in-memory or scripted adapter at its seam: `ProjectTest`, `callTool`, the scripted agent, `fakeApi` and the stores, `createPreview` on the scripted renderer | flows, concurrency, what follows a change |
| Request | the editor's RPC handlers over a test's own project through an in-memory client (`ProjectRpc`, `inAProject`), no socket, on the test clock | what an editor request does end to end inside the server |
| Wire | the server over its socket (`TestServer`) | only what the wire does: schema rejection, the origin and token guards, event streaming, health |
| End to end | the editor in a headless Chrome (`pnpm bench:canvas`), a real agent (`pnpm evals round`) | by hand, out of CI |

A behaviour that crosses no wire is not tested over the socket.

### 2. Never sleep to wait: await the signal

- Wait for the thing itself: `Fiber.join`, a `Deferred`, an event the module publishes
  (`events.subscribe`, `threadWhen`), the store's state as `fakeApi` delivers it, a promise the
  module returns.
- Time-driven behaviour (debounce, timeouts, retries, schedules) runs on the test clock:
  `it.effect` gives `TestClock`; move it with `TestClock.adjust`. In the web, `vi.useFakeTimers()`
  with `await vi.advanceTimersByTimeAsync(ms)` (the async form, so promises queued by the timers
  settle), and `vi.useRealTimers()` in `afterEach`.
- `waitFor` (server `testing/wait-for.ts`) is only for IO a test cannot be told about (a file a
  real watcher writes, a server over its socket). It polls and has a bounded timeout; it is never
  how a test orders two things it controls.
- `setTimeout`, `Effect.sleep`, `it.live` and a retry in a test need a `// real clock:` comment on
  the line or just above it saying why the real clock is the behaviour under test (`// fake clock:`
  for a timer `vi.useFakeTimers` fakes); `pnpm test` fails without one (`scripts/test-guards.test.ts`).

### 3. Every test builds its own world

- No test depends on another having run first. A `layer(...)` shared by a `describe` is fine for
  something immutable or expensive to build (a fixture read once); state a test changes is made
  fresh for that test (a scoped temporary directory, a fresh in-memory store, a project opened in
  the test's own scope).
- Nothing a test does outlives it: fake timers, mocks, stubs, globals, `localStorage` and the
  web's stores are reset in `afterEach` (or by a fresh scope). A module that subscribes at import
  time is a polluter by construction; new code exposes an explicit `start`/`stop` or a scope.
- Files go in a temporary directory acquired with `Effect.acquireRelease` (or `tmpdir` plus
  cleanup), never in the repository or a fixed path. A server listens on port 0.
- On the server, `eachTest(world)` (or `perTest`) in `testing/each-test.ts` builds a test's world
  afresh for every test and every repeat, on the test clock from `TEST_EPOCH` (never 0, which the
  server reads as "never"). A block written `layer(world)((it) => …)` without a name closes its
  world after as many tests as it holds, repeats included: name it, or use `eachTest`.
- In the web, wait for what the code does, not for time: `until` (a store's change),
  `fakeApi.requested` (a request sent) and `caughtUp()` (the reads of a connection landed).

### 4. Make the nondeterministic things inputs

- The clock (`Clock`, `TestClock`), randomness and ids (`TestRandom`, or an id maker passed in),
  the environment (`ServerConfig`, never `process.env` below `bin.ts`) and the platform (the
  web's `Platform`) are given to the module, so a test gives fixed ones.
- Do not assert on the order of things the code does not order (a `Map` built from concurrent
  results, a directory listing): sort, or assert as a set.
  Two things the code orders by time alone are a clock step apart (`TestClock.adjust`), never on
  one instant. Checkpoints, named snapshots and Figma imports break a tie by the order their ids
  were made (`newestFirst` in the server's `ids.ts`), and a test of that makes them on one instant.
- Hermetic: no network, no real agent, no real Figma, no real `git` remote. The seams that have a
  test adapter (the agent launcher, the preview's renderer, the snapshot store, the sync sides)
  exist for this.

### 5. Assert outcomes, precisely and once

- One behaviour per test, named for it ("a rename follows into the instances' props").
- Assert the observable outcome, not the steps (not "called X then Y" unless the order is the
  behaviour, as with ACP calls at the agent seam).
- Snapshots only of small, stable, reviewed values; never of a whole page or a log.
- A bug fix comes with the test that failed before it.

### 6. Find flakiness before it finds you

- `pnpm test:shuffle` runs every package with test files and tests in a random order (a new seed
  each run, printed in the output; pass `--sequence.seed=<n>` to replay one). An order-dependent
  test fails here first.
- A test suspected of flaking is run many times in isolation
  (`pnpm -F <pkg> exec vitest run <file> --repeats=50`) before and after the fix.
- Retries are not configured and not added: a retried test is a flaky test whose cause is
  unknown.

### 7. Keep them fast

A slow test is run less, and a test run less hides more. A module test runs in milliseconds; a
test over the socket in tens. A test that takes over a second says why in its name or a comment.
