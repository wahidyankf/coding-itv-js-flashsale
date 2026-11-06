# AGENTS.md

Guidance for AI coding agents working in this repository. For setup and run commands, see `README.md`.

## Project

Flash sale monorepo with five apps in `apps/` and two libraries in `libs/`: `flash-be` (Fastify REST API), `flash-web` (TanStack Start client),
`flash-be-e2e` and `flash-web-e2e` (Playwright), and `flash-load` (k6 load test). `libs/typekit` (`@flash/typekit`) holds `Result` and `attempt`; `flash-be` and `flash-web` use it. `libs/contract` (`@flash/contract`) holds the HTTP contract of the API; every app uses it. Data lives in Postgres (Kysely, no ORM) and Redis.

## Docs and specs

- `docs/` is the documentation for users and developers, split into Diátaxis modes. Start at [docs/README.md](docs/README.md).
- `specs/` holds the apps' behaviour scenarios (`specs/apps/flash/be` and `web`), their C4 model, and the load test rules (`specs/apps/flash/load/`). Start at [specs/README.md](specs/README.md). Specs win when they disagree with `docs/`.

## Repository rules

- Default branch is `main`. Do not commit or push unless the user asks.
- Node and npm are pinned with Volta in `package.json`. Run `npm install` at the root. The apps and the libraries are npm
  workspaces with one `package-lock.json`.
- Nx runs commands only. Do not add Nx plugins (`@nx/*`, `nx-*`) or run `nx init`. Define every target in the app's
  `project.json` with `"executor": "nx:run-commands"`.
- `libs/typekit` is built to `dist` (`npx nx build typekit`). The Nx targets of the apps that use it build it first, and the
  Dockerfiles build it too. It has `build`, `typecheck`, `lint`, `test:unit`, `test:coverage` and `test:quick`, each with a `:watch` variant where one exists, and needs no Docker.
- Run targets with `npx nx <target> <app>`. Every app has `typecheck`, `lint`, `test:quick`, and `test:quick:watch`.
  - `flash-be` and `flash-web` also have `test:unit` and `test:integration`.
  - `flash-be-e2e` and `flash-web-e2e` have `test:e2e` instead.
  - `flash-load` has `load:smoke`, `load:full`, `load:chaos`, `load:burst` and `load:contention` instead. They need Docker and run the stack. Its numbers are in
    `apps/flash-load/k6/profiles.ts`, and its rules and limits are in `specs/apps/flash/load/`. A failed run is a finding; do not change a limit to make it pass.
  - `test:quick` runs `typecheck`, `lint`, and `test:unit`, or only `typecheck` and `lint` for the e2e apps. Change a
    check in its own target, not in `test:quick`. Keep `test:quick:watch` in sync with it.
- The HTTP API is written down once, in `libs/contract`. Do not write a hand-made request type, reply type, API path or
  error-code literal, or the name of the ticket header, in an app. Change the contract first (`docs/how-to/change-an-endpoint.md`),
  then the handler and the consumers. Build requests with `buildRequest` and read replies with `parseReply` or the client. An error reply is `{ errorCode, errorMessage }` (plus `retryAfterSeconds` for `429`), built with `errorPayload`; the status is not in the body.
  `npm run contract:guard:test` fails on a path or the header written by hand. `docs/reference/openapi.json` is generated:
  run `npm run openapi:generate` after a change; `npm run openapi:check` runs in the pre-push hook.
- `libs/contract` is built to `dist` like typekit (`npx nx build contract`), and the Nx targets of the apps that use it build it
  first. It has `build`, `typecheck`, `lint`, `test:unit`, `test:coverage` and `test:quick`, and needs no Docker.
- Biome formats and lints (tabs, double quotes). Do not add Prettier or ESLint.
- Failures are values. Product code (`apps/*/src`, `libs/*/src`, not tests or `src/bdd`) has no `catch` clause and no
  `.catch(` call: a call that may throw goes through `attempt` or `attemptAsync` from `@flash/typekit`, naming the failure it
  expects, and a function that can fail returns a `Result`. A lookup that may find nothing returns `undefined`, typed `T | undefined`. Close every
  `switch` over a union with every case. A Biome plugin (`.biome/no-catch.grit`) and
  `useExhaustiveSwitchCases` enforce this, and `npm run lint:rules:test` tests the rules. Do not silence them.
- Typechecking and linting are strict. Every `tsconfig.json` turns on `strict`, `noUncheckedIndexedAccess`,
  `exactOptionalPropertyTypes`, `noImplicitOverride`, `noImplicitReturns`, `noUnusedLocals`, `noUnusedParameters` and
  `verbatimModuleSyntax`. Biome rules for unused code, non-null assertions, type-only imports and floating or misused
  promises are errors, and `lint` fails on warnings. Fix the code; do not relax a rule to pass.
- No `any` in TypeScript. Biome's `noExplicitAny` is an error, and `noImplicitAny` is on in every `tsconfig.json`. Use
  `unknown` and narrow it, or write the type. Do not silence the rule with `biome-ignore`.
- No magic numbers. Biome's `noMagicNumbers` is an error in product code and in tooling (tests, `src/bdd` and the e2e apps
  may write literals, because a literal is the expected value there). Give a number a name: a `const`, or a field of a
  `const` object, with a comment when the reason is not plain. HTTP statuses come from `ERROR_STATUS` and `HTTP_STATUS`, and
  seconds become milliseconds with `MS_PER_SECOND`, all from `@flash/contract`. Do not silence the rule with `biome-ignore`.
- Commit messages follow Conventional Commits (commitlint hook). Make one coherent change per commit.
- Docs are checked by RHINO, which reads the policy in `repo-config.yml`. Run `npm run docs:install` once per machine,
  then `npm run docs:check`. The version and digests are pinned in `scripts/install-rhino.sh`; bump them together.
- The pre-push hook runs `npm run lint` (Biome check of the whole repo, warnings fail), `npm run docs:check`, the behaviour
  coverage check (`bdd:check:test`, `bdd:check`), the lint rule tests (`lint:rules:test`), the OpenAPI check (`openapi:check`),
  the contract guard (`contract:guard:test`), then
  `nx affected -t test:quick` (typecheck, lint, unit tests) and `nx affected -t test:coverage` (the 99% floor) against
  `origin/main`. `test:coverage` starts the dev stack itself, so Docker must run. Do not skip hooks with `--no-verify`
  unless the user asks.

## Tests

- Use TDD: write a failing test, make it pass with the least code, then refactor. Run the test first to see it fail.
- Unit tests sit next to the source as `*_tests.ts` or `*_tests.tsx`. Integration tests are
  `*_integration_tests.ts(x)` with their own Vitest config. They need the dev compose stack
  (`npx nx db:up flash-be`) and are not part of `test:quick`.
- Vitest globals are off. Call `cleanup` in `afterEach` when rendering components.
- Choose the kind of test by one question: if this breaks, does a shopper or an operator see the difference? If yes, write
  a Gherkin scenario in `specs/apps/flash/` (behaviour that is part of the contract: HTTP, queue, hold, payment). If only a developer cares, write a plain Vitest test next to
  the code (branches and edge cases in one function, rules of structure such as `architecture_tests.ts`, the mapping of
  config and environment variables, types, internal helpers, tests that only reach a branch for coverage). Write new behaviour as a scenario first,
  then add plain tests for the branches that do not deserve one. A scenario that needs both `@integration-exempt` and
  `@e2e-exempt` in an app is a sign of a detail: make it a plain test. See `docs/explanation/scenario-or-plain-test.md`.
- Only the apps use Gherkin. `libs/` and `scripts/` have plain Vitest tests and no `specs/` scenarios. Behaviour scenarios
  are canonical in `specs/apps/flash/`. Bind each one at unit. Bind integration and e2e too, unless the
  scenario has `@integration-exempt` or `@e2e-exempt`. One scenario may carry both tags. Each tag needs the comment
  format in `docs/how-to/add-a-behaviour.md`, and the unit binding is the alternative proof.
- Run `npm run bdd:check` after changing a feature file or a binding. It checks the scenarios of `flash-be` and `flash-web`
  only, and it runs in the pre-push hook.
- Keep combined coverage at 99% (`npx nx test:coverage <app>`). Integration tests run inside that gate; e2e tests stay out of the hooks.
- Write docs by Diátaxis mode (`docs/`). Show only commands you ran. Architecture diagrams are Mermaid with an
  `accTitle`, an `accDescr`, and the palette in `repo-config.yml`.
- E2E tests run against real servers. Keep `/health` (flash-be), `/ready` (flash-be), and `/api/health` (flash-web)
  working. The Playwright configs and specs depend on them.

## Backend

- Never oversell and never sell one user twice. Postgres has the last word: the `UPDATE ... WHERE sold < stock`, the
  `UNIQUE(sale_id, user_id)` and the `CHECK (sold <= stock)` must stay, whatever Redis says. Redis is a fast gate that
  Postgres can rebuild. A change to the sale path needs a concurrency scenario, and `flash-load` must still pass.
- Redis keys are `sale:<saleId>:` plus `{ready,buyers,holds,ids,rebuild-lock}` for the hold gate, and plus
  `{queue,queue-seq,admitted,admit-lead}` for the queue. Every command on the sale path must fail at
  once when Redis is down. Use single scripts, not `MULTI`, which waits for the connection.
- `flash-be` is a hexagon (see `docs/explanation/hexagonal-architecture.md`). Rules go in `src/domain` (no I/O, only Node
  built-ins, `@flash/typekit` and `@flash/contract/vocabulary`). Use cases go in `src/application`, which reach stores only through `src/application/ports`. Adapters go in
  `src/adapters/inbound` (HTTP, CLI) and `src/adapters/outbound` (Postgres, Redis, memory, payment, clock). Only
  `composition.ts` and the entry points pick an adapter for a port. `architecture_tests.ts` fails on a wrong import.
  Put a new rule in the domain with a unit test first, not in a service or a route.
- Routes are in `apps/flash-be/src/adapters/inbound/http/routes.ts`, with full paths. Migrations are hand-written in
  `apps/flash-be/src/adapters/outbound/postgres/migrations`. Use Kysely as a query builder. Do not add an ORM.
- Config is built once from `process.env` in `src/config.ts`. `buildConfig` is exported for tests. Local defaults match
  `compose.dev.yaml`. In production, a missing required URL must fail fast.
- Env vars are listed in `.env.example`. Never commit `.env`. Do not use the example passwords outside local
  development.
- `POST /admin/sales` creates a sale and is the only operator route. It needs `ADMIN_TOKEN` and is never passed on by `flash-web`. Keep it
  off the `passThrough` routes of the contract; a contract test fails if it is on. Overlap is refused there only, not in the seed command.
- `api-flash-be.http` and `api-flash-web.http` hold manual requests, one file per app. Update them when an endpoint changes. It does not replace tests.

## Code style

- Keep comments, commit messages, and notes brief. Explain why, not what.
- Use neutral domain names in docs and commits: say "shopper", "sale", "hold" and "purchase".
- Use clear, simple English that is easy for non-native speakers to read.
