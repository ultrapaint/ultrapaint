# Glossary format

<!-- upstream: mattpocock/skills skills/engineering/domain-modeling/GLOSSARY-FORMAT.md -->

How the glossary is written, once a term is resolved. Where it lives is [`DECISIONS.md`](./DECISIONS.md) `## Before exploring, read these`; the examples below use `GLOSSARY.md`, and a project that keeps `CONTEXT.md` writes the same thing there.

## One glossary

```md
# {Context name}

{One or two sentences: what this context is and why it exists.}

## Language

**Order**:
A customer's request to buy one or more products.
_Avoid_: Purchase, transaction

**Invoice**:
A request for payment sent to a customer after delivery.
_Avoid_: Bill, payment request
```

- **Be opinionated.** Where several words name one concept, pick the best and list the others under `_Avoid_`.
- **Keep definitions tight.** One or two sentences: what the term _is_, not what it does.
- **Only the project's own concepts.** A general programming concept — a timeout, an error type, a utility pattern — stays out, however much the project uses it.
- **Group terms under subheadings** when natural clusters emerge. One cohesive area is a flat list.
- **No implementation details.** The glossary is not a spec, a scratch pad or a home for implementation decisions. It is a glossary and nothing else.

## Several contexts

A map at the root lists the contexts, where each glossary lives, and how they relate:

```md
# Glossary map

## Contexts

- [Ordering](./src/ordering/GLOSSARY.md): receives and tracks customer orders
- [Billing](./src/billing/GLOSSARY.md): generates invoices and processes payments

## Relationships

- **Ordering → Billing**: Ordering emits `OrderPlaced`; Billing consumes it to generate an invoice
```

With a map, infer which context the term belongs to, and ask when it is unclear. With neither file, create a root glossary when the first term is resolved — never before.
