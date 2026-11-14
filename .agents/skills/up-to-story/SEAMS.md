# Seams

<!-- upstream: mattpocock/skills skills/engineering/codebase-design/SKILL.md -->

The vocabulary for deciding where a seam goes and what sits behind it. [`/up-to-story` § 3](./SKILL.md#3-settle-the-seams) settles the seams with it, [`/up-implement`](../up-implement/TDD.md) tests at them, [`/up-diagnose`](../up-diagnose/SKILL.md) looks for one to hold a regression test, and [`/up-architect`](../up-architect/SKILL.md) designs with it and hunts the shallow modules it describes.

Design **deep modules**: a lot of behaviour behind a small interface, placed at a clean seam, testable through that interface. The aim is leverage for callers, locality for maintainers, and testability for everyone.

## Glossary

Use these terms exactly — not "component", "service", "API" or "boundary". Consistent language is the whole point.

- **Module** — anything with an interface and an implementation. Deliberately scale-agnostic: a function, a class, a package, a slice across tiers. _Avoid_: unit, component, service.
- **Interface** — everything a caller must know to use the module correctly: the type signature, and also invariants, ordering constraints, error modes, required configuration and performance characteristics. _Avoid_: API, signature — both name only the type-level surface.
- **Implementation** — what is inside a module, its body of code. Distinct from **adapter**: a thing can be a small adapter with a large implementation (a Postgres repository) or a large adapter with a small implementation (an in-memory fake). Say "adapter" when the seam is the topic, "implementation" otherwise.
- **Depth** — leverage at the interface: how much behaviour a caller, or a test, can exercise per unit of interface they have to learn. A module is **deep** when a lot of behaviour sits behind a small interface, **shallow** when the interface is nearly as complex as the implementation.
- **Seam** _(Michael Feathers)_ — a place where you can alter behaviour without editing in that place: the _location_ of a module's interface. Where the seam goes is its own decision, distinct from what goes behind it. _Avoid_: boundary — overloaded with the domain's bounded context.
- **Port** — an interface defined at a seam for a dependency the module does not own outright, so production and tests plug in different adapters.
- **Adapter** — a concrete thing that satisfies an interface at a seam. It names a _role_, the slot it fills, not what is inside.
- **Leverage** — what callers get from depth: more capability per unit of interface learned. One implementation pays back across every call site and every test.
- **Locality** — what maintainers get from depth: change, bugs, knowledge and verification concentrate in one place instead of spreading across callers. Fixed once, fixed everywhere.

## Principles

- **Depth is a property of the interface, not the implementation.** A deep module can be built from small, mockable, swappable parts; they are just not part of its interface. A module has **internal seams**, private to its implementation and used by its own tests, as well as the **external seam** at its interface.
- **The deletion test.** Imagine deleting the module. If the complexity vanishes, it was a pass-through. If it reappears across its callers, it was earning its keep.
- **The interface is the test surface.** Callers and tests cross the same seam. Wanting to test _past_ the interface says the module is the wrong shape.
- **One adapter means a hypothetical seam. Two adapters mean a real one.** Introduce a seam only where something actually varies across it — typically production and test.

When designing an interface, ask: can it have fewer methods, simpler parameters, more complexity hidden inside? Good interfaces make testing natural — they **accept their dependencies** rather than creating them, **return results** rather than producing side effects, and keep a **small surface**: fewer methods need fewer tests, and fewer parameters need less setup.

## Dependencies decide how a seam is tested

<!-- upstream: mattpocock/skills skills/engineering/codebase-design/DEEPENING.md -->

Classify what the module depends on. The category says how the module is tested across its seam.

| Dependency | Example | Tested with |
| --- | --- | --- |
| **In-process** | Pure computation, in-memory state, no I/O | The real thing, through the interface. No adapter. |
| **Local stand-in** | PGLite for Postgres, an in-memory file system, a fake browser storage | The stand-in, running in the suite — injected at the seam only where the test environment cannot supply it. |
| **Remote but owned** | The project's own services across a network | A **port** at the seam: a network adapter in production, an in-memory adapter in tests. |
| **Truly external** | Stripe, Twilio — services you do not control | An injected port, and a mock adapter in tests. |

## Replace tests, do not layer them

When shallow modules merge into a deeper one, the tests move to its interface:

- Old tests on the shallow modules become waste once tests at the new interface exist. Delete them.
- New tests assert on observable outcomes through the interface, never on internal state.
- A test that has to change when the implementation changes is testing past the interface.
