# Test-first

<!-- upstream: mattpocock/skills skills/engineering/tdd/SKILL.md -->

The red → green loop of [`/up-implement` § 5](./SKILL.md#5-build-it-test-first), and what makes it produce tests worth keeping: what a good test is, where tests go, the anti-patterns, and the rules of the loop. Every section applies on every cycle — consult them before and during the loop, not after.

## What a good test is

Tests verify behaviour through public interfaces, not implementation details. Code can change entirely; tests should not. A good test reads like a specification — "user can checkout with valid cart" says exactly what capability exists — and survives refactors because it does not care about internal structure.

## Seams — where tests go

A **seam** is the public boundary you test at: the interface where you observe behaviour without reaching inside. Tests live at seams, never against internals.

**Test only at agreed seams.** The story names them — [`/up-to-story` § 3](../up-to-story/SKILL.md#3-settle-the-seams) put them to the user. A seam the story does not name is an **open question** before its first test is written: give each proposed seam a one-line note on what it catches and what it misses. Agreeing the seams up front is how testing effort lands on the critical paths and the complex logic instead of every edge case.

When the shape of the interface is itself in question — how deep the module is, where the seam belongs, what the interface should expose — [`SEAMS.md`](../up-to-story/SEAMS.md) holds the vocabulary: module, interface, depth, seam, adapter, leverage, locality.

## Anti-patterns

- **Implementation-coupled** — mocks internal collaborators, tests private methods, or verifies through a side channel (querying the database instead of using the interface). The tell: the test breaks on a refactor that changed no behaviour.
- **Tautological** — the assertion recomputes the expected value the way the code does (`expect(add(a, b)).toBe(a + b)`, a snapshot derived by hand the same way, a constant asserted equal to itself), so it passes by construction and can never disagree with the code. Expected values come from an independent source of truth: a known-good literal, a worked example, the spec.
- **Horizontal slicing** — writing all tests first, then all implementation. Bulk tests verify _imagined_ behaviour: they test the _shape_ of things rather than what the user sees, they go insensitive to real changes, and they commit to a test structure before the implementation is understood. Work in **vertical slices** instead — one test → one implementation → repeat, each test a **tracer bullet** that responds to what the last cycle taught you.

## Rules of the loop

- **Red before green.** Write the failing test first, then only enough code to pass it. Do not anticipate future tests or add speculative features.
- **One slice at a time.** One seam, one test, one minimal implementation per cycle.
- **Refactoring is not part of the loop.** It belongs to the review, [`/up-implement` § 7](./SKILL.md#7-review-the-diff), not the red → green cycle.

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
