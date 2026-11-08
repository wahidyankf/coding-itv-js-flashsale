# AGENTS.md

Guidance for AI coding agents working in this repository. For setup and run commands, see [`README.md`](README.md).

## Project

Flash sale monorepo with five apps in [`apps/`](apps) and two libraries in [`libs/`](libs): `flash-be` (Fastify REST API), `flash-web` (TanStack Start client, styled with Tailwind CSS),
`flash-be-e2e` and `flash-web-e2e` (Playwright), and `flash-load` (k6 load test). `libs/typekit` (`@flash/typekit`) holds `Result` and `attempt` and nothing else: the type of a failure and the wrappers that make one, with no rule of any app and no shared helper. `libs/flash-commons` (`@flash/flash-commons`) holds the behaviour and values that several apps share: retry with backoff and jitter, time units, HTTP status numbers, the payload decoders, the id rule (`isUuid`), the cookie jar, the time phrases of the scenarios and the table of API paths (`API_PATHS`) on its pure main entry, and `sleep` on `@flash/flash-commons/timers`. Data lives in Postgres (Kysely, no ORM) and Redis. [docs/reference/code-map.md](docs/reference/code-map.md) says where each kind of thing lives, and each app's `README.md` says where to add one.

## Docs and specs

- [`docs/`](docs) is the documentation for users and developers, split into Diátaxis modes. Start at [docs/README.md](docs/README.md).
- Every `.md` file can be reached from the root [`README.md`](README.md) by following links, one level at a time: the root README
  links the top indexes ([`docs/README.md`](docs/README.md), [`specs/README.md`](specs/README.md), [`AGENTS.md`](AGENTS.md), the app and library READMEs), and each folder
  README links its direct children. A new page gets a link in its folder's README; nothing is listed only in the root.
- A code change updates the docs that describe it, in the same change. Before you call it done, search [`docs/`](docs),
  [`specs/`](specs), every `README.md`, [`AGENTS.md`](AGENTS.md) and [`.claude/`](.claude) for each path, name, route, error code, env var, command and
  number you changed, and fix every page that is now wrong. Docs are the main session's job, so an agent names each
  stale page to its caller instead of leaving it.
- [`REQUIREMENTS.md`](REQUIREMENTS.md) lists what the system must do (minimum), what it adds (extended) and what it leaves out, each with its proof. A change that adds, removes or moves a requirement, or moves its proof, updates it.
- [`specs/`](specs) holds the apps' behaviour scenarios (`specs/apps/flash/be` and `web`), their C4 model, and the load test rules ([`specs/apps/flash/load/`](specs/apps/flash/load)). Start at [specs/README.md](specs/README.md). Specs win when they disagree with [`docs/`](docs).

## Claude Code agents and skills

[`.claude/`](.claude) holds Claude Code config only, with no copy for other tools. Each file is complete in itself and takes its rules from this file.

- Skill `grill-me` ([`.claude/skills/grill-me/SKILL.md`](.claude/skills/grill-me/SKILL.md)): asks a real decision as options with one recommendation, through `AskUserQuestion`, and records the answer.
- Subagents in [`.claude/agents/`](.claude/agents). Pick the one that owns the work:

  | Work                                                                                              | Use                                                                                                                                                                                       |
  | ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | write or change code, tests, scenarios or config ([`package.json`](package.json), `project.json`) | [`swe-developer`](.claude/agents/swe-developer.md) (Haiku), test-first; also applies findings from a review or a test                                                                     |
  | a type check, lint or test command fails                                                          | [`swe-debugger`](.claude/agents/swe-debugger.md): one cause at a time, never a suppressed check                                                                                           |
  | a change touches a module boundary, a new dependency or a trade-off                               | [`swe-architect`](.claude/agents/swe-architect.md) before building and again before done; it writes only decision records, in [`docs/explanation/decisions/`](docs/explanation/decisions) |
  | review changed code, components or bindings                                                       | [`swe-reviewer`](.claude/agents/swe-reviewer.md), read-only                                                                                                                               |
  | check the running API at `localhost:8080`                                                         | [`swe-api-tester`](.claude/agents/swe-api-tester.md)                                                                                                                                      |
  | check the running page at `localhost:3000` in a browser                                           | [`swe-web-tester`](.claude/agents/swe-web-tester.md)                                                                                                                                      |
  | a goal that needs several of the above                                                            | [`swe-orchestrator`](.claude/agents/swe-orchestrator.md), as the main thread (`claude --agent swe-orchestrator`), because a subagent cannot start agents                                  |
  | docs ([`docs/`](docs), every `README.md`, this file) and the `.http` files                        | the main session; no agent owns them                                                                                                                                                      |
  | a choice with more than one defensible answer                                                     | the skill `grill-me`                                                                                                                                                                      |
- All of them except `swe-developer` run on Sonnet. None of them commits. Their scratch records go to `local-tmp/`, which git ignores.
- Biome skips [`.claude/`](.claude) ([`biome.json`](biome.json)): its Markdown formatter would break the YAML frontmatter. `npm run docs:check` still checks these files.
- When a rule here changes and an agent repeats it (checks, ports, paths), update that agent too.

## Repository rules

- Default branch is `main`. Do not commit or push unless the user asks.
- Node and npm are pinned with Volta in [`package.json`](package.json). Run `npm install` at the root. The apps and the libraries are npm
  workspaces with one [`package-lock.json`](package-lock.json).
- Nx runs commands only. Do not add Nx plugins (`@nx/*`, `nx-*`) or run `nx init`. Define every target in the app's
  `project.json` with `"executor": "nx:run-commands"`.
- `libs/typekit` and `libs/flash-commons` are built to `dist` (`npx nx build typekit`, `npx nx build flash-commons`). Their build and that of `flash-be` run [`scripts/compile/build-dist.mjs`](scripts/compile/build-dist.mjs): `tsc` writes `dist` in place, then every file in `dist` that this run did not write is removed, so a deleted source never keeps running from an old output and `dist` is never empty while another build reads it. The Nx targets of the apps that use them build them first, and the
  Dockerfiles build them too. Each has `build`, `typecheck`, `lint`, `test:unit`, `test:coverage` and `test:quick`, each with a `:watch` variant where one exists, and needs no Docker.
- Run targets with `npx nx <target> <app>`. Every app has `typecheck`, `lint`, `test:quick`, and `test:quick:watch`.
  - `flash-be` and `flash-web` also have `test:unit` and `test:integration`.
  - `flash-be-e2e` and `flash-web-e2e` have `test:e2e` instead.
  - `flash-load` has `test:unit` (the pure parts: verdict, report, sampler, collect, accounts, paths and the VU pools of the profiles) and `load:smoke`, `load:full`, `load:chaos`, `load:burst` and `load:contention`. The load targets need Docker and run the stack. Its numbers are in
    [`apps/flash-load/k6/profiles.ts`](apps/flash-load/k6/profiles.ts), and its rules and limits are in [`specs/apps/flash/load/`](specs/apps/flash/load). A failed run is a finding; do not change a limit to make it pass.
  - `test:quick` runs `typecheck`, `lint`, and `test:unit` (flash-load included), or only `typecheck` and `lint` for the e2e apps. Change a
    check in its own target, not in `test:quick`. Keep `test:quick:watch` in sync with it.
- The HTTP API is plain code. The routes are in [`apps/flash-be/src/adapters/inbound/http/routes/`](apps/flash-be/src/adapters/inbound/http/routes), one file per area, and the error codes with
  their statuses and sentences are in [`errors.ts`](apps/flash-be/src/adapters/inbound/http/errors.ts) in `http/`. Every route is served under `/api/v1`
  (the probes `/health` and `/ready` stay at the root), and every path comes from `API_PATHS` in
  [`libs/flash-commons/src/api-paths.ts`](libs/flash-commons/src/api-paths.ts): `flash-be`, `flash-web`, the e2e apps and
  `flash-load` import it, and only the `.http` files and the docs write a path out. A path change also edits the literal tables in
  [`api-paths_tests.ts`](libs/flash-commons/src/api-paths_tests.ts) and in flash-be's
  [`routes/index_tests.ts`](apps/flash-be/src/adapters/inbound/http/routes/index_tests.ts) on purpose
  ([`docs/explanation/decisions/019-api-version-prefix.md`](docs/explanation/decisions/019-api-version-prefix.md)). A change to a route or a reply updates the handler, every caller, [`docs/reference/http-endpoints.md`](docs/reference/http-endpoints.md) and the
  scenario ([`docs/how-to/change-an-endpoint.md`](docs/how-to/change-an-endpoint.md)). An error reply is `{ errorCode, errorMessage }` (plus `retryAfterSeconds`
  for `429`); the status is not in the body.
- Biome formats and lints (tabs, double quotes). Do not add Prettier or ESLint.
- `flash-web` is styled with Tailwind classes in the components ([`src/styles.css`](apps/flash-web/src/styles.css) only imports Tailwind and sets `color-scheme`). Do not add inline
  style blocks or another CSS library. The page must stay readable from a phone to a desktop and in light and dark mode. Colour
  is never the only signal: the words stay on screen.
- Failures are values. Product code (`apps/*/src`, `libs/*/src`, not tests or `src/bdd`) has no `catch` clause and no
  `.catch(` call: a call that may throw goes through `attempt` or `attemptAsync` from `@flash/typekit`, naming the failure it
  expects, and a function that can fail returns a `Result`. A lookup that may find nothing returns `undefined`, typed `T | undefined`. Close every
  `switch` over a union with every case. A Biome plugin ([`.biome/no-catch.grit`](.biome/no-catch.grit)) and
  `useExhaustiveSwitchCases` enforce this, and `npm run lint:rules:test` tests the rules. Do not silence them.
- Typechecking and linting are strict. Every `tsconfig.json` turns on `strict`, `noUncheckedIndexedAccess`,
  `exactOptionalPropertyTypes`, `noImplicitOverride`, `noImplicitReturns`, `noUnusedLocals`, `noUnusedParameters` and
  `verbatimModuleSyntax`. Biome rules for unused code, non-null assertions, type-only imports and floating or misused
  promises are errors, and `lint` fails on warnings. Fix the code; do not relax a rule to pass.
- No `any` in TypeScript. Biome's `noExplicitAny` is an error, and `noImplicitAny` is on in every `tsconfig.json`. Use
  `unknown` and narrow it, or write the type. Do not silence the rule with `biome-ignore`.
- No magic numbers. Biome's `noMagicNumbers` is an error in product code and in tooling (tests, `src/bdd` and the e2e apps
  may write literals, because a literal is the expected value there). Give a number a name: a `const`, or a field of a
  `const` object, with a comment when the reason is not plain. HTTP status numbers come from `HTTP_STATUS` in `@flash/flash-commons`, the status of an error code from `ERROR_STATUS` ([`errors.ts`](apps/flash-be/src/adapters/inbound/http/errors.ts) in `flash-be`), and
  seconds become milliseconds with `MS_PER_SECOND` from `@flash/flash-commons`. Do not silence the rule with `biome-ignore`.
- Size limits are Biome built-in rules, errors in [`biome.json`](biome.json): cognitive complexity 15 per function, 80 lines per function, 5 parameters,
  4 nested callbacks, no nested ternary, and 400 lines per file (blank lines do not count). Test files are exempt from the two line limits, and
  migrations from the function line limit. Split a function only into steps a reader would name ("parse the body", "take the hold"); do not
  make one-line wrappers or split code that is under the limits and reads top to bottom. Do not raise a limit to pass.
- Every source file starts with a header comment that says what the module is for and where it sits. A test file sits next to
  the code it tests, so its header only says what it tests. Every export has a doc comment that says
  why it exists and what it promises, not what the code does. Biome has no rule for this, so `swe-reviewer` checks it.
- DRY by the rule of three: two copies are fine, and the third use gets one named constant or function in the app, in the folder that owns it.
  When 3 or more places across the apps use it, it goes in `libs/flash-commons`. Its main entry stays pure; a helper that starts a timer or does I/O goes on its own entry, as `sleep` does on `/timers`. The exception is the test oracles: the
  e2e apps and `flash-load` write the API's headers, error codes and statuses themselves, so a changed reply fails a test. The API's paths are
  not part of that exception: everyone imports `API_PATHS`, and its literal tripwire test makes a rename visible ([019](docs/explanation/decisions/019-api-version-prefix.md)). A rule that only
  `flash-be` and `flash-web` share stays copied and is guarded by [`same_as_be_tests.ts`](apps/flash-web/src/same_as_be_tests.ts) in `flash-web`. See
  [`docs/explanation/decisions/016-dry-rule-of-three.md`](docs/explanation/decisions/016-dry-rule-of-three.md).
- Every retry uses `retry` or `retryAsync` (or `backoffDelayMs`) from `@flash/flash-commons`: exponential backoff, a max attempt count and full
  jitter. The only retry without a max is the Redis reconnect, by design. See [`docs/explanation/decisions/017-retry-backoff-jitter.md`](docs/explanation/decisions/017-retry-backoff-jitter.md) and
  [`docs/reference/retry-policies.md`](docs/reference/retry-policies.md).
- A change that adds a new kind of file or folder updates the `README.md` of its app, so the README tree and the code stay the same.
- Commit messages follow Conventional Commits (commitlint hook). Make one coherent change per commit.
- Docs are checked by RHINO, which reads the policy in [`repo-config.yml`](repo-config.yml). Run `npm run docs:install` once per machine,
  then `npm run docs:check`. The version and digests are pinned in [`scripts/install-rhino.sh`](scripts/install-rhino.sh); bump them together.
- The pre-push hook runs, in order, `npm run lint` (Biome check of the whole repo, warnings fail), `npm run docs:check`,
  `bdd:check:test`, `lint:rules:test`, `build:script:test` (the tests of the build script), `trace:script:test` (the tests of the log tracer), `bdd:check` (the behaviour coverage check), then
  `nx affected -t test:quick` (typecheck, lint, unit tests) and `nx affected -t test:coverage` (the 99% floor) against
  `origin/main`. `test:coverage` starts the dev stack itself, so Docker must run. Do not skip hooks with `--no-verify`
  unless the user asks.

## Tests

- Use TDD: write a failing test, make it pass with the least code, then refactor. Run the test first to see it fail.
- Unit tests sit next to the source as `*_tests.ts` or `*_tests.tsx`. Integration tests are
  `*_integration_tests.ts(x)` with their own Vitest config. Those of `flash-be` need the dev compose stack
  (`npx nx db:up flash-be`); those of `flash-web` serve a fake `flash-be` over HTTP. They are not part of `test:quick`.
- Vitest globals are off. Call `cleanup` in `afterEach` when rendering components.
- Choose the kind of test by one question: if this breaks, does a shopper or an operator see the difference? If yes, write
  a Gherkin scenario in [`specs/apps/flash/`](specs/apps/flash) (behaviour that is part of the contract: HTTP, queue, hold, payment). If only a developer cares (a branch, a rule of
  structure, config mapping, an internal helper), write a plain Vitest test next to the code. Write new behaviour as a
  scenario first, then plain tests for the branches. A scenario that needs both `@integration-exempt` and `@e2e-exempt`
  is a detail: make it a plain test. See [scenario or plain test](docs/explanation/scenario-or-plain-test.md).
- Only the apps use Gherkin. [`libs/`](libs) and [`scripts/`](scripts) have plain Vitest tests and no [`specs/`](specs) scenarios. Behaviour scenarios
  are canonical in [`specs/apps/flash/`](specs/apps/flash). Bind each one at unit. Bind integration and e2e too, unless the
  scenario has `@integration-exempt` or `@e2e-exempt`. One scenario may carry both tags. Each tag needs the comment
  format in [`docs/how-to/add-a-behaviour.md`](docs/how-to/add-a-behaviour.md), and the unit binding is the alternative proof.
- Run `npm run bdd:check` after changing a feature file or a binding. It checks the scenarios of `flash-be` and `flash-web`
  only, and it runs in the pre-push hook.
- Keep combined coverage at 99% (`npx nx test:coverage <app>`). Integration tests run inside that gate; e2e tests stay out of the hooks.
- Write docs by Diátaxis mode ([`docs/`](docs)). Show only commands you ran. Architecture diagrams are Mermaid with an
  `accTitle`, an `accDescr`, and the palette in [`repo-config.yml`](repo-config.yml).
- E2E tests run against real servers. Keep `/health` (flash-be), `/ready` (flash-be), and `/api/health` (flash-web)
  working. The Playwright configs and specs depend on them.

## Backend

- Never oversell and never sell one user twice. Postgres has the last word: the `UPDATE ... WHERE sold < stock`, the
  `UNIQUE(sale_id, user_id)` and the `CHECK (sold <= stock)` must stay, whatever Redis says. Redis is a fast gate that
  Postgres can rebuild. A change to the sale path needs a concurrency scenario, and `flash-load` must still pass.
- Redis keys are `sale:<saleId>:` plus `{ready,buyers,holds,ids,rebuild-lock}` for the hold gate, and plus
  `{queue,queue-seq,admitted,admit-lead}` for the queue. Sessions are cached under `session:<access hash>`, and the rate counters are under `ratelimit:`. Every command on the sale path must fail at
  once when Redis is down. Use single scripts, not `MULTI`, which waits for the connection.
- `flash-be` is a hexagon (see [`docs/explanation/hexagonal-architecture.md`](docs/explanation/hexagonal-architecture.md)). Rules go in `src/domain` (no I/O, only Node
  built-ins, `@flash/typekit` and the main entry of `@flash/flash-commons`, never `/timers`). Use cases go in `src/application`, which reach stores only through `src/application/ports`. Adapters go in
  `src/adapters/inbound` (HTTP, CLI) and `src/adapters/outbound` (Postgres, Redis, memory, payment, clock). Only
  [`composition.ts`](apps/flash-be/src/composition.ts) and the entry points pick an adapter for a port. [`architecture_tests.ts`](apps/flash-be/src/architecture_tests.ts) fails on a wrong import.
  Put a new rule in the domain with a unit test first, not in a service or a route.
- Routes are in `apps/flash-be/src/adapters/inbound/http/routes/<area>.ts`, each with its full path from `API_PATHS`, never a literal ([`architecture_tests.ts`](apps/flash-be/src/architecture_tests.ts) fails on one); [`routes/index.ts`](apps/flash-be/src/adapters/inbound/http/routes/index.ts) registers every area. Migrations are hand-written in
  `apps/flash-be/src/adapters/outbound/postgres/migrations`, which holds one file, `0001_schema.ts`: a schema change edits it, with the indexes its queries need, and a local database built before the change is rebuilt with `npm run demo:reset`. Use Kysely as a query builder. Do not add an ORM.
- Config is built once from `process.env` in [`src/config.ts`](apps/flash-be/src/config.ts). `buildConfig` is exported for tests. Local defaults match
  [`compose.dev.yaml`](compose.dev.yaml). In production, a missing required URL must fail fast.
- Accounts and sessions ([`docs/explanation/authentication.md`](docs/explanation/authentication.md)): shoppers and operators log in with a user name and a password.
  Two cookies carry the session: `access_token` (15 minutes, path `/`) and `refresh_token` (7 days, path `/api/v1/auth`, used once,
  replaying the one it replaced ends the session). Both are `HttpOnly` and `SameSite=Lax`, and `Secure` when `COOKIE_SECURE` is true.
  Never put a token in a body, a URL or a log, and store only SHA-256 hashes of tokens and scrypt hashes of passwords. No
  route takes a user id: the shopper is `/queue/me`, `/purchases/me` and the session. The first operator is made with
  `create-operator`; sign-up can only make a shopper. The `/api/v1/auth` routes have their own rate limit (`AUTH_RATE_LIMIT_PER_IP`).
- Nothing is hard-deleted. Every table has `created_at`, `created_by`, `updated_at`, `updated_by`, `deleted_at` and
  `deleted_by` (the `*_by` columns point at `users`). A removal sets `deleted_at` and `deleted_by`; every read adds
  `deleted_at IS NULL`, and the unique indexes on a live row are partial (`WHERE deleted_at IS NULL`); `purchases.reservation_id` stays plainly unique, because a hold is paid for once ever. Product code never calls
  `deleteFrom(`; [`architecture_tests.ts`](apps/flash-be/src/architecture_tests.ts) fails if it does. A new table gets the six columns and an entry in the `Database`
  type, and [`schema_integration_tests.ts`](apps/flash-be/src/adapters/outbound/postgres/schema_integration_tests.ts) checks both.
- Env vars are listed in [`.env.example`](.env.example). Never commit `.env`. Do not use the example passwords outside local
  development.
- The operator routes are `POST`, `GET` (list), `PATCH` and `DELETE` under `/api/v1/admin/sales`. They need the login of an operator (`401 not_authenticated`, `403 forbidden` for a shopper) and are never passed on by `flash-web`. Keep them
  off the allow-list of the `flash-web` proxy; a test there fails if one is on it. Overlap is refused there only, not in the seed command. A started sale keeps its start and cannot lose stock, a sale that is over cannot change, and a sale with a purchase cannot be removed.
- `GET /api/v1/sales/current` and the admission timer use one rule (`pickCurrent`, `admitCurrentSale`): the running sale, else the next to open, else none. Do not use "the sale that opens last".
- [`api-flash-be.http`](api-flash-be.http) and [`api-flash-web.http`](api-flash-web.http) hold one request per route, one file per app. [`api-flash-demo.http`](api-flash-demo.http) is the demo story in order ([`docs/how-to/run-the-demo.md`](docs/how-to/run-the-demo.md)). All three use the kulala.nvim format (https://github.com/wahidyankf/kulala.nvim): a `Shared` block with `# @attach-cookie-jar`, and `# @name` (letters and `_` only) for a reply that later requests read. Update them when an endpoint changes. They do not replace tests.
- The `demo:*` scripts in the root [`package.json`](package.json) set up and run the demo. `demo:reset` wipes the local data; never run it without being asked.

## Code style

- Keep comments, commit messages, and notes brief. Explain why the code is needed, not what it does. Use clear, simple,
  and natural English that is easy for non-native speakers to understand.
- Use neutral domain names in docs and commits: say "shopper", "sale", "hold" and "purchase".
