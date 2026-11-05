# coding-itv-js-flashsale

Flash sale monorepo: a Fastify REST API (`flash-be`) and a TanStack Start web client (`flash-web`), with Playwright e2e tests for both. It uses Node.js, TypeScript, Kysely (query builder), Postgres, Redis, and Nx (core only, no plugins).

## Layout

- `apps/flash-be`: REST API. Routes are in `src/routes.ts`. Migrations are in `src/migrations`.
- `apps/flash-be-e2e`: Playwright API tests against `flash-be`.
- `apps/flash-web`: TanStack Start client. It calls `flash-be` over REST.
- `apps/flash-web-e2e`: Playwright browser tests against `flash-web`.
- `apps/flash-load`: k6 load test against three `flash-be` instances behind nginx.
- `compose.dev.yaml`: Postgres and Redis for local development (project name `flash-dev`).
- `compose.prod.yaml`: the full stack in containers (project name `flash-prod`).
- `api.http`: manual requests for the running apps (kulala.nvim format, `,rh` in Neovim sends one).

## Setup

1. Node.js is pinned with Volta (see `package.json`). Install Volta, then run `npm install`. This also installs the Git hooks.
2. Copy the env file: `cp .env.example .env`. The values are for local use only.
3. Playwright needs Chromium for browser tests: `npx playwright install chromium`.

## Run locally (apps on the host)

```bash
npm run docker:dev:up          # Postgres + Redis
npx nx db:migrate flash-be     # apply migrations
npx nx dev flash-be            # API on http://localhost:8080
npx nx dev flash-web           # web on http://localhost:3000
npm run docker:dev:down        # stop Postgres + Redis
```

## Run everything in containers

```bash
npm run docker:prod:up        # build images, run migrations, start the stack
curl localhost:8080/ready     # API: Postgres and Redis ok
open localhost:3000           # web: shows "Backend: ok"
npm run docker:prod:down      # stop the stack (volumes are kept)
```

Production compose reads `POSTGRES_*` and the port values from `.env`. Do not use the example passwords outside local development.

## Checks

Each app has the same Nx targets:

```bash
npx nx typecheck <app>        # tsc --noEmit
npx nx lint <app>             # Biome
npx nx test:unit <app>        # unit tests (flash-be, flash-web)
npx nx test:integration <app> # needs the dev compose stack (flash-be, flash-web)
npx nx test:e2e <app>         # Playwright (flash-be-e2e, flash-web-e2e)
npx nx test:quick <app>       # typecheck + lint + unit
```

Docs (Markdown links, heading structure, README indexes, and Mermaid diagrams) are checked by a pinned RHINO release. Run `npm run docs:install` once to fetch it into `.tools/`, then `npm run docs:check`. The policy is in `repo-config.yml`.

Behaviour scenarios are checked against their bindings with `npm run bdd:check`. The combined unit and integration coverage gate (99%) is `npx nx test:coverage <app>`, which needs the dev compose stack.

## Load test

`npx nx load:smoke flash-load` (500 shoppers), `load:full` (5,000 shoppers) and `load:chaos` (Redis stops mid-run) run the
stack in Docker and then check Postgres and Redis. The limits are fixed before any run: reserve p95 under 300 ms,
purchase p95 under 500 ms, and no server errors. No item may be sold twice or over the stock. See
[docs/reference/load-test.md](docs/reference/load-test.md).

## Documentation

- [docs/](docs/README.md): tutorials, how-to guides, reference, and explanation.
- [specs/](specs/README.md): the Gherkin behaviour scenarios and the C4 architecture. Specs win when they disagree with the docs.

Commits are checked with commitlint (Conventional Commits). Staged JS and JSON files are formatted by Biome on commit. `git push` runs `npm run docs:check`, then `nx affected -t test:quick` against `origin/main`.
