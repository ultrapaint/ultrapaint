# Test-first

<!-- upstream: mattpocock/skills skills/engineering/tdd/SKILL.md -->

The red → green loop of [`/up-implement` § 5](./SKILL.md#5-build-it-test-first), and what makes it produce tests worth keeping: what a good test is, where tests go, the anti-patterns, and the rules of the loop. Every section applies on every cycle — consult them before and during the loop, not after.

## What a good test is

Tests verify behaviour through public interfaces, not implementation details. Code can change entirely; tests should not. A good test reads like a specification — "user can checkout with valid cart" says exactly what capability exists — and survives refactors because it does not care about internal structure.

A good test fails when the behaviour a user or another system relies on breaks. Prefer the larger unit — a module, a feature — over a tiny isolated function where the seam allows it, and spend the tests on edge cases, error paths and meaningful transformations.

## Seams — where tests go

A **seam** is the public boundary you test at: the interface where you observe behaviour without reaching inside. Tests live at seams, never against internals.

**Test only at agreed seams.** The story names them — [`/up-to-story` § 3](../up-to-story/SKILL.md#3-settle-the-seams) put them to the user. A seam the story does not name is an **open question** before its first test is written: give each proposed seam a one-line note on what it catches and what it misses. Agreeing the seams up front is how testing effort lands on the critical paths and the complex logic instead of every edge case.

When the shape of the interface is itself in question — how deep the module is, where the seam belongs, what the interface should expose — [`SEAMS.md`](../up-to-story/SEAMS.md) holds the vocabulary: module, interface, depth, seam, adapter, leverage, locality.

## Anti-patterns

- **Implementation-coupled** — mocks internal collaborators, tests private methods, or verifies through a side channel (querying the database instead of using the interface). The tell: the test breaks on a refactor that changed no behaviour.
- **Tautological** — the test adds no verification: it restates the implementation, checks a trivial constant, or asserts what is true by construction, so it passes even when the behaviour is wrong. The common shapes: an expected value recomputed the way the code computes it (`expect(add(a, b)).toBe(a + b)`); a constant string checked for substrings of itself; a function asserted to return the value it is hardcoded to return; a snapshot of internal details that always matches the code. Expected values come from an independent source of truth: a known-good literal, a worked example, the spec.
- **Testing what has no logic** — a pure constant or a mapping with no logic is used, not tested: its test is a copy of it. Test the behaviour that uses it instead.
- **Horizontal slicing** — writing all tests first, then all implementation. Bulk tests verify _imagined_ behaviour: they test the _shape_ of things rather than what the user sees, they go insensitive to real changes, and they commit to a test structure before the implementation is understood. Work in **vertical slices** instead — one test → one implementation → repeat, each test a **tracer bullet** that responds to what the last cycle taught you.

## Rules of the loop

- **Would it catch a real bug?** Before writing a test, ask: if I introduced a real bug in the logic, would this test fail? That is its **P** in [`TEST-VALUE.md`](./TEST-VALUE.md): a test that cannot fail on a plausible defect is not written. Where a defect costs what a person sees, stored data, a permission or money, make the answer observable: break the logic by hand, watch the test go red, and revert.
- **Red tests are frozen.** Once a story's test has gone red, the build changes the code, not the test. The code is correct for every valid input the story covers, never shaped around the test's own inputs. A test that turns out wrong is fixed as a test, and the change and its reason go in the hand-off; a test whose expectation you doubt is an **open question** for the user.
- **Red before green.** Write the failing test first, then only enough code to pass it. Do not anticipate future tests or add speculative features.
- **One slice at a time.** One seam, one test, one minimal implementation per cycle.
- **Refactoring is not part of the loop.** It belongs to the review, [`/up-implement` § 8](./SKILL.md#8-review-the-diff), not the red → green cycle.

## Good and bad tests

<!-- upstream: mattpocock/skills skills/engineering/tdd/tests.md -->

**Through real interfaces**, not mocks of internal parts:

```typescript
// GOOD: tests observable behaviour
test("user can checkout with valid cart", async () => {
  const cart = createCart();
  cart.add(product);
  const result = await checkout(cart, paymentMethod);
  expect(result.status).toBe("confirmed");
});
```

A good test cares about what callers care about, uses the public API only, survives internal refactors, describes _what_ and not _how_, and makes one logical assertion.

**Coupled to internal structure:**

```typescript
// BAD: tests implementation details
test("checkout calls paymentService.process", async () => {
  const mockPayment = jest.mock(paymentService);
  await checkout(cart, payment);
  expect(mockPayment.process).toHaveBeenCalledWith(cart.total);
});
```

Red flags: mocking internal collaborators, testing private methods, asserting on call counts or order, a test name that describes _how_, and verifying by other means than the interface:

```typescript
// BAD: bypasses the interface to verify
test("createUser saves to database", async () => {
  await createUser({ name: "Alice" });
  const row = await db.query("SELECT * FROM users WHERE name = ?", ["Alice"]);
  expect(row).toBeDefined();
});

// GOOD: verifies through the interface
test("createUser makes user retrievable", async () => {
  const user = await createUser({ name: "Alice" });
  const retrieved = await getUser(user.id);
  expect(retrieved.name).toBe("Alice");
});
```

**Tautological** — the expected value restates the implementation:

```typescript
// BAD: expected value recomputed the way the code computes it
test("calculateTotal sums line items", () => {
  const items = [{ price: 10 }, { price: 5 }];
  const expected = items.reduce((sum, i) => sum + i.price, 0);
  expect(calculateTotal(items)).toBe(expected);
});

// GOOD: expected value is an independent, known literal
test("calculateTotal sums line items", () => {
  expect(calculateTotal([{ price: 10 }, { price: 5 }])).toBe(15);
});

// BAD: a constant checked against itself — passes whatever signup does
test("invalid email message mentions the email", () => {
  expect(INVALID_EMAIL_MESSAGE).toContain("email");
});

// GOOD: the behaviour that uses the constant
test("signup rejects an invalid email", async () => {
  const result = await signup({ email: "not-an-email" });
  expect(result.error).toBe(INVALID_EMAIL_MESSAGE);
});
```

## When to mock

<!-- upstream: mattpocock/skills skills/engineering/tdd/mocking.md -->

Mock at **system boundaries** only: external APIs (payment, email), time and randomness, and — sometimes — the database and the file system, where the project has no test stand-in for them. Never mock your own modules or internal collaborators: anything you control is tested for real.

At a system boundary, shape the interface so it is easy to mock:

- **Inject the dependency** rather than creating it inside:

  ```typescript
  // Easy to mock
  function processPayment(order, paymentClient) {
    return paymentClient.charge(order.total);
  }

  // Hard to mock
  function processPayment(order) {
    const client = new StripeClient(process.env.STRIPE_KEY);
    return client.charge(order.total);
  }
  ```

- **One function per external operation**, not one generic fetcher with conditional logic. Each mock then returns one shape, test setup carries no conditionals, and each test shows which endpoints it exercises:

  ```typescript
  // GOOD: each function is independently mockable
  const api = {
    getUser: (id) => fetch(`/users/${id}`),
    getOrders: (userId) => fetch(`/users/${userId}/orders`),
    createOrder: (data) => fetch("/orders", { method: "POST", body: data }),
  };

  // BAD: the mock needs conditional logic
  const api = {
    fetch: (endpoint, options) => fetch(endpoint, options),
  };
  ```
