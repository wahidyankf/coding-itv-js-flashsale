# AGENTS.md

Guidance for AI coding agents working in this repository. For setup and run commands, see `README.md`.

## Project

Flash sale monorepo with five apps in `apps/`: `flash-be` (Fastify REST API), `flash-web` (TanStack Start client),
`flash-be-e2e` and `flash-web-e2e` (Playwright), and `flash-load` (k6 load test). Data lives in Postgres (Kysely, no ORM) and Redis.

## Docs and specs

- `docs/` is the documentation for users and developers, split into Diátaxis modes. Start at [docs/README.md](docs/README.md).
- `specs/` holds the behaviour scenarios and the C4 architecture. Start at [specs/README.md](specs/README.md). Specs win when they disagree with `docs/`.

## Repository rules

- Default branch is `main`. Do not commit or push unless the user asks.
- Node and npm are pinned with Volta in `package.json`. Run `npm install` at the root. All five apps are npm
  workspaces with one `package-lock.json`.
- Nx runs commands only. Do not add Nx plugins (`@nx/*`, `nx-*`) or run `nx init`. Define every target in the app's
  `project.json` with `"executor": "nx:run-commands"`.
- Run targets with `npx nx <target> <app>`. Every app has `typecheck`, `lint`, `test:quick`, and `test:quick:watch`.
  - `flash-be` and `flash-web` also have `test:unit` and `test:integration`.
  - `flash-be-e2e` and `flash-web-e2e` have `test:e2e` instead.
  - `flash-load` has `load:smoke`, `load:full` and `load:chaos` instead. They need Docker and run the stack. Its limits are in
    `apps/flash-load/k6/profiles.ts`. A failed run is a finding; do not change a limit to make it pass.
  - `test:quick` runs `typecheck`, `lint`, and `test:unit`, or only `typecheck` and `lint` for the e2e apps. Change a
    check in its own target, not in `test:quick`. Keep `test:quick:watch` in sync with it.
- Biome formats and lints (tabs, double quotes). Do not add Prettier or ESLint.
- Typechecking and linting are strict. Every `tsconfig.json` turns on `strict`, `noUncheckedIndexedAccess`,
  `exactOptionalPropertyTypes`, `noImplicitOverride`, `noImplicitReturns`, `noUnusedLocals`, `noUnusedParameters` and
  `verbatimModuleSyntax`. Biome rules for unused code, non-null assertions, type-only imports and floating or misused
  promises are errors, and `lint` fails on warnings. Fix the code; do not relax a rule to pass.
- No `any` in TypeScript. Biome's `noExplicitAny` is an error, and `noImplicitAny` is on in every `tsconfig.json`. Use
  `unknown` and narrow it, or write the type. Do not silence the rule with `biome-ignore`.
- Commit messages follow Conventional Commits (commitlint hook). Make one coherent change per commit.
- Docs are checked by RHINO, which reads the policy in `repo-config.yml`. Run `npm run docs:install` once per machine,
  then `npm run docs:check`. The version and digests are pinned in `scripts/install-rhino.sh`; bump them together.
- The pre-push hook runs `npm run docs:check`, the behaviour coverage check (`bdd:check:test`, `bdd:check`), then
  `nx affected -t test:quick` (typecheck, lint, unit tests) and `nx affected -t test:coverage` (the 99% floor) against
  `origin/main`. `test:coverage` starts the dev stack itself, so Docker must run. Do not skip hooks with `--no-verify`
  unless the user asks.

## Tests

- Use TDD: write a failing test, make it pass with the least code, then refactor. Run the test first to see it fail.
- Unit tests sit next to the source as `*_tests.ts` or `*_tests.tsx`. Integration tests are
  `*_integration_tests.ts(x)` with their own Vitest config. They need the dev compose stack
  (`npx nx db:up flash-be`) and are not part of `test:quick`.
- Vitest globals are off. Call `cleanup` in `afterEach` when rendering components.
- Behaviour scenarios are canonical in `specs/`. Bind each one at unit. Bind integration and e2e too, unless the
  scenario has `@integration-exempt` or `@e2e-exempt`. One scenario may carry both tags. Each tag needs the comment
  format in `docs/how-to/add-a-behaviour.md`, and the unit binding is the alternative proof.
- Run `npm run bdd:check` after changing a feature file or a binding. It runs in the pre-push hook.
- Keep combined coverage at 99% (`npx nx test:coverage <app>`). Integration tests run inside that gate; e2e tests stay out of the hooks.
- Write docs by Diátaxis mode (`docs/`). Show only commands you ran. Architecture diagrams are Mermaid with an
  `accTitle`, an `accDescr`, and the palette in `repo-config.yml`.
- E2E tests run against real servers. Keep `/health` (flash-be), `/ready` (flash-be), and `/api/health` (flash-web)
  working. The Playwright configs and specs depend on them.

## Backend

- Never oversell and never sell one user twice. Postgres has the last word: the `UPDATE ... WHERE sold < stock`, the
  `UNIQUE(sale_id, user_id)` and the `CHECK (sold <= stock)` must stay, whatever Redis says. Redis is a fast gate that
  Postgres can rebuild. A change to the sale path needs a concurrency scenario, and `flash-load` must still pass.
- Redis keys are `sale:<saleId>:{ready,buyers,holds,ids,rebuild-lock}`. Every command on the sale path must fail at
  once when Redis is down. Use single scripts, not `MULTI`, which waits for the connection.
- Routes are in `apps/flash-be/src/routes.ts`, with full paths. Migrations are hand-written in
  `apps/flash-be/src/migrations`. Use Kysely as a query builder. Do not add an ORM.
- Config is built once from `process.env` in `src/config.ts`. `buildConfig` is exported for tests. Local defaults match
  `compose.dev.yaml`. In production, a missing required URL must fail fast.
- Env vars are listed in `.env.example`. Never commit `.env`. Do not use the example passwords outside local
  development.
- `api.http` holds manual requests. Update it when an endpoint changes. It does not replace tests.

## Code style

- Keep comments, commit messages, and notes brief. Explain why, not what.
- Use neutral domain names in docs and commits: say "shopper", "sale", "hold" and "purchase".
- Use clear, simple English that is easy for non-native speakers to read.
