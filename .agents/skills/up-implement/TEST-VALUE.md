# Test Value

What a test is worth, and when it should not exist. It applies at every level the **Test levels** setting names (`/up` `## Settings`). The project's own test standards say how to write a test at each level; this file says whether it should be written, kept, moved or deleted. The project's rules add to it and win where they differ.

A test costs run time on every gate and attention on every change that breaks it. It earns that cost only by catching a real defect. A test that cannot catch one, or that catches only what another test already catches, is a cost with no return.

The levels below are named by what they observe: **unit** (a return value or emitted output, no I/O), **integration** (a real store or service behind a public API), **journey** (what a person sees in a running app). Map each of the project's levels to the nearest one.

## The four axes

The score is Vladimir Khorikov's four pillars (*Unit Testing: Principles, Practices, and Patterns*, ch. 4). Score each axis 0–3. The axes are the same at every level, so a test can be compared with a cheaper test at another level.

**P — Protection against regressions.** Would a plausible defect in the code under test make this test fail?

| | Meaning |
| --- | --- |
| 3 | It covers logic where a defect changes what a person sees, the data stored, a permission, or money, and it fails on that defect. |
| 2 | It covers real logic with a narrower reach: a branch of a formatter, an edge case, a refusal code. |
| 1 | It covers code with little logic (wiring, a pass-through, a constant), or it asserts so loosely that most defects pass. |
| 0 | It cannot fail on a plausible defect: it asserts a mock it set up, a guarantee of the framework, a type the compiler already checks, or nothing. |

**R — Resistance to refactoring.** Does it still pass when the code changes and the behaviour does not?

| | Meaning |
| --- | --- |
| 3 | It asserts only what its level observes: what the person sees (journey), the API result and the stored data (integration), the return value or the emitted output (unit). |
| 2 | Mostly behaviour, with one incidental detail: an exact call count that is not a contract, a class name. |
| 1 | It is coupled to structure: a mock of the project's own module, an internal call order, DOM structure or a test id where a role or label exists. |
| 0 | It asserts the implementation itself. Any refactor breaks it. |

**F — Fast feedback.** Measured, per test, against its own level. A journey is never fast next to a unit test; that trade-off is why the levels exist.

| | Unit | Integration | Journey |
| --- | --- | --- | --- |
| 3 | under 50 ms | under 300 ms | under 5 s |
| 2 | under 500 ms | under 1 s | under 15 s |
| 1 | under 5 s | under 5 s | under 30 s |
| 0 | 5 s or more | 5 s or more | 30 s or more, or a raised timeout |

**M — Maintainability.** How cheap is it to read and to keep working?

| | Meaning |
| --- | --- |
| 3 | Arrange, act, assert, readable in one screen. It uses the suite's shared fixtures and has no logic of its own. |
| 2 | Some setup noise, still clear. |
| 1 | Long or duplicated setup, conditional logic, or one of the smells below. |
| 0 | A reader must run it to understand what it proves. |

The **value** is the product P × R × F × M, from 0 to 81. Khorikov multiplies on purpose: a 0 on any axis drags the value to nothing, however well the test does on the others. The value ranks tests; the rule below decides what happens to them, and it treats the axes differently. A 0 on P or R means the test cannot earn its place at all — it catches no defect, or it breaks on every refactor — so it goes. A 0 on F or M is a cost, not a verdict: a slow or obscure test that protects real behaviour is made faster or clearer, not deleted.

## The checks around the score

**Level fit.** Each level has an entry rule. A test that fails its level's rule is at the wrong level.

| Level | Entry rule | Belongs elsewhere when |
| --- | --- | --- |
| Journey | A journey a person performs, ending in what they see. | It proves a rule the backend decides — that goes to integration, and the journey keeps only what the person sees when the rule refuses them. |
| Integration | Backend behaviour against the real store. A test whose claim is a guard, a permission or a refusal goes through the public API as the caller it names, so the guard runs. | It tests a pure function — that goes to unit. |
| Unit | Pure logic with real branches, or a hook or component with meaningful logic of its own. | It renders a whole page, form or route in a simulated DOM — that proves the harness, not the product, and goes to a journey. |

**Need.** Does another test already fail on the same defect? A test is **redundant** when another test at the same level or a cheaper one asserts the same behaviour. Partial overlap is not redundancy: two tests that share a setup but assert different branches both earn their place.

**Determinism.** A gate, not a score. A test passes the gate when its outcome cannot change with the time of day, the date, machine speed, machine load, test order or anything else outside the code under test. A test that fails the gate is fixed or deleted; it is never kept with a low score.

- A test whose assertion depends on time pins the clock with the test tool's fake timers. Fixture data built from the current time is fine only when no assertion can change with the value it reads.
- No arbitrary sleep. Wait for the condition — a web-first assertion in a journey, a fake-timer advance elsewhere.
- No state that outlives a test: no module-level value one test sets and another reads, nothing written outside a temporary directory.
- A journey fails on any page error or console error it did not declare.
- A test that depends on machine state — the working tree, `git`, a child process — states that dependency in a comment and owns a time budget sized from measurement.

**A slow suite earns a budget, never a retry.** A retry re-runs a failure without anyone reading it, which is how a real defect gets waved through; and it cannot reach a failure that is not a failed test, such as a worker pool that never starts. A suite that does real I/O gets a timeout sized from measurement, per package, re-sized when the work grows. A browser journey is the one place a retry may absorb network nondeterminism, and only in CI.

## The rule

| The test | Action |
| --- | --- |
| Scores P = 0 or R = 0 | Delete it. Where the behaviour it meant to cover is real and uncovered, replace it with a test that covers it. |
| Is redundant | Delete it, and name the test that covers it. |
| Fails its level's entry rule | Move it to the level the rule names. |
| Fails the determinism gate | Fix it. Delete it only when the fix costs more than the protection it gives, and say so. |
| Scores F = 0 or M = 0 | Fix the cost: move it to a cheaper level, cut its setup, or name what it proves. |
| Scores R = 1 or M = 1 | Keep it, and fix it when you next touch it. |
| Anything else | Keep it. |

A deletion carries its reason in the PR that makes it: the axis that scored 0, or the test that already covers it.

## Naming a defect

Name a test's defects with the smells from Gerard Meszaros, *xUnit Test Patterns*, so a reason reads the same in every review:

- **Erratic Test** — passes and fails on the same code. Name the cause: Interacting Tests, Resource Leakage, Nondeterministic Test (clock, randomness, order).
- **Fragile Test** — breaks on a change that kept the behaviour. Usually R ≤ 1.
- **Sleepy Test** — waits a fixed time instead of for a condition.
- **Slow Test** — F = 0.
- **Obscure Test** — a reader cannot see what it proves. Its forms: **Mystery Guest** (the data it depends on is out of sight), **Eager Test** (it verifies several behaviours at once), **Irrelevant Information**.
- **Assertion Roulette** — several assertions, and a failure does not say which behaviour broke.
- **Conditional Test Logic** — an `if` or a loop decides what the test asserts.
- **Test Code Duplication** — the same setup copied across tests instead of a fixture.

## Finding a flaky test

A clean run proves less than it looks. After N passing runs, the rule of three bounds the failure rate below 3/N at 95% confidence: 10 runs prove less than 30%, 20 runs less than 15%.

A flake has three causes, and each needs its own condition to show:

| Cause | Condition that shows it |
| --- | --- |
| Intrinsic — the test or the product races itself | Run alone, repeated — 20 runs. |
| Load — it fails only on a busy machine | Run while other suites run on the same machine. |
| Order — it depends on another test's leftovers | Run in shuffled order. |

A fix counts when the test passes 20 of 20 alone and five full suite runs under load. Record the cause of every flake found: a bad test, or a product defect. A product defect is fixed in the product, not hidden in the test.

**Completion criterion:** every test the change adds or touches scores above 0 on P and R, fits its level's entry rule, duplicates no other test, and passes the determinism gate; every test the change deletes is listed in its PR with the reason.
