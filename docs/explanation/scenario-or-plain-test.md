# Scenario or plain test

A test is written as a Gherkin scenario when it describes behaviour that somebody outside the code can see. It is a plain
Vitest test when it guards how the code does its work. This page gives the reasons and a question to ask.

Only the apps use Gherkin. The libraries in `libs/` and the repository's tools in `scripts/` always use plain tests, so
the question below applies to the apps only.

## The question

> If this breaks, does a shopper or an operator see the difference?

- **Yes**: write a scenario in `specs/`.
- **No**, and only a developer cares: write a plain test next to the code.

## Write a scenario when

- A reader of the spec can understand it without reading code. For example: "a shopper who already bought cannot buy
  again", "Redis is down, so `/ready` answers 503", "too many requests get `429` with `Retry-After`".
- The behaviour is part of the contract of the system: the HTTP routes, the queue, the hold and the payment.
- The same behaviour is worth proving at more than one layer. One `.feature` file is then the shared source of truth for
  the unit, integration and end-to-end bindings.
- A person who does not write code, or you in three months, needs to read it as documentation.

## Write a plain test when

- It checks a branch or an edge case inside one function or module: the validation of a name, the rounding of a time, the
  order of arguments. As scenarios, these would crowd `specs/` and make it hard to read.
- It checks a rule of structure, such as `architecture_tests.ts`, which keeps the layers from importing each other. That is
  not behaviour of the system.
- It checks how config and environment variables are mapped: the defaults, the values read, and the values refused. It
  can also check a type (`expectTypeOf`, `@ts-expect-error`) or an internal helper.
- It was written to reach a branch so that coverage stays at 99%.
- Nobody but a developer can observe it. The address in `FLASH_BE_URL`, the port in `FLASH_BE_PORT`, and the rollback of
  a migration (the shipped process only migrates upward) are examples. A scenario that no end-to-end test can show is a
  sign that it belongs here.

## In practice

1. Write a new behaviour as a scenario first (see [add a behaviour](../how-to/add-a-behaviour.md)).
2. Complete it with plain tests for the branches that are not worth a scenario.
3. Do not write a scenario for a detail just to give it a binding. `npm run bdd:check` only counts scenarios; it does not
   forbid plain tests.
4. A scenario that needs both `@integration-exempt` and `@e2e-exempt` is proved at the unit layer only. Ask whether it
   is behaviour or a detail. So far it has been a detail every time.

Both kinds of test run in `test:unit` and count towards the 99% floor in the same way. See
[test layers and coverage](../reference/test-layers-and-coverage.md).
