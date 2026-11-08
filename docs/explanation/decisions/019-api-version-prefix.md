# 019: Every API route lives under `/api/v1`, and one path table in `flash-commons` names them all

## Status

Accepted. Every API route of `flash-be` is served under `/api/v1`, and the browser reaches the same path on `flash-web`. The
probes `/health` and `/ready` stay at the root. One module in `libs/flash-commons` is the only place code writes an
API path, the tests and the scripts that call the API included. Only the `.http` files and the docs write them out.

## Context

The page, the web server, the e2e tests and the load test all call the API, and the browser must send the refresh cookie
back to the auth routes, so the browser path and the API path should be the same. A breaking change to a reply or a route
needs room next to the current one, or it breaks a page that is already open. A reader should see the whole API surface in
one place, and a change to it should be one edit, not a search. The set of API paths is a contract that `flash-be` and
`flash-web` must agree on exactly. A URL change is a product decision that goes through review, and there are no clients
outside this repository, so every caller can follow one deliberate change.

## Decision

- **One prefix, `API_PREFIX = "/api/v1"`.** Every route of the sales, events, queue, reservation, purchase, auth and operator
  areas is served under it. `/health` and `/ready` are probes, not API. Compose, the Dockerfiles, nginx and the Playwright
  configs depend on them, so they stay unprefixed. `flash-web` keeps its own probe at `/api/health`. An unknown path, such as
  one without the version, gets `404 not_found`.
- **One path table, `libs/flash-commons/src/api-paths.ts`,** on the pure main entry of `@flash/flash-commons`. It exports
  `API_PREFIX`, `AUTH_BASE_PATH` (`/api/v1/auth`), `PROBE_PATHS` (`/health` and `/ready`) and `API_PATHS`, which names every
  route path: the current sale, one sale, its events, the queue, the queue place and its events, reservations, purchases, the shopper's
  purchase, the five auth routes and the two operator paths. It holds paths only, with `:saleId` in a template, and no
  methods or handlers.
- **`flash-be` uses it,** in every route file and in `cookies.ts`. The route files write no path of their own.
  `REFRESH_COOKIE_PATH` is `AUTH_BASE_PATH`. The access cookie is at `/`.
- **`flash-web` uses it,** in the page clients (`sale/client.ts`, `auth/client.ts`, `web-api.ts`), in the server-side sale
  loader and in the proxy. `BROWSER_ROUTES` in `api-paths.ts` is the ordered list of method and entry pairs, built from
  `API_PATHS` without the operator paths, and the proxy turns it into its allow-list. The order matters, because `/sales/current` must come before the sale-id pattern. A client and
  the allow-list read the same entries, so they cannot name different paths. The proxy forwards the path unchanged: the
  browser path and the API path are the same, so neither the path nor a cookie is rewritten.
- **No app writes its own path strings, and `same_as_be_tests.ts` has no path guard.** `flash-web`'s `api-paths.ts` only
  picks table entries and their methods for the browser. The compiler holds both apps to one source.
- **The oracles import it too:** `flash-be-e2e`, `flash-web-e2e`, the k6 script and its runner, and the prod smoke script.
  The k6 bundle takes only the pure main entry, which holds no Node built-ins. The `.http` files and the docs cannot import,
  so they stay literal and are covered by the docs rule in `AGENTS.md`. This is an exception to the oracle rule of
  [016](016-dry-rule-of-three.md), which records it.
- **One literal tripwire keeps a rename from passing silently.** `libs/flash-commons/src/api-paths_tests.ts` asserts the whole
  table against literal strings with `toEqual`, and the `flash-be` route-table test writes its expected paths out literally.
  A path change must edit both on purpose, and the diff shows it in review.
- **No unprefixed alias.** There are no clients outside this repository.

### Threats

- The prefix is naming, not a security boundary. Authentication, the operator role check, the rate limits and the proxy
  allow-list do the guarding.
- The allow-list fails closed. It lists only the shopper routes and its patterns are anchored on the full path, so
  `/api/v1/admin/sales` is refused by omission, and so is any path with an extra prefix. A test fails if an operator
  route is ever on the list.
- Sharing the table makes a wrong entry reach every caller at once, the tests included, so a renamed or wrong entry does
  not fail an e2e, smoke or k6 run by itself. The literal tripwire test and the literal expectations of the
  `flash-be` route-table test are the alarm instead, and they fail on any change to the table. The operator paths are
  never in the web list, and a test says so.
- The refresh token reaches only the auth routes, because the cookie path is `AUTH_BASE_PATH`. With no rewrite, there is no
  second place where the cookie path could drift from the real route.

## Alternatives considered

- **No version in the path.** Cheapest, but the first breaking change then has nowhere to go.
- **A version in a header or a media type.** The version would be invisible in logs, in the `.http` files and in a browser
  address bar, and the proxy list matches on method and path only.
- **An unversioned alias next to `/api/v1`.** It doubles the surface that tests and the allow-list must cover, to serve clients that
  do not exist.
- **Only a prefix constant, with each path written in its area file.** The paths stay spread over seven files, so the surface
  is harder to see and a change is a search.
- **Fastify `register(..., { prefix })`.** One line and no repetition, but the full path then appears nowhere in the code, so
  a reader cannot grep for it, and the cookie path and the web list would still need their own copy of the prefix.
- **One path module per app, guarded by `same_as_be_tests.ts`.** This follows the repository's
  pattern for a rule only `flash-be` and `flash-web` share ([016](016-dry-rule-of-three.md)). Rejected: the path set is a
  contract that both sides must agree on, so one compiled source enforces it better than a guard test. A copy can drift
  when someone forgets to add it to the guard test. A shared source cannot drift.
- **The oracles keep their own literal paths.** This is the rule of [016](016-dry-rule-of-three.md):
  a test that imports the server's paths cannot fail when the server changes them. Rejected: every path change would be
  retyped in dozens of places, and the single literal tripwire gives the same alarm. A URL change is a product decision
  that goes through review, and with no outside clients all callers should follow one change.
- **`/api` on the web side and `/` on the API side.** The web server would have to rewrite every path and the refresh
  cookie's path, and each route would have two names.

## Consequences

- It costs one edit per path in the table, in the tripwire tests, in the `.http` files and in the docs that name a path.
  The oracles are not independent of the table, which is why the tripwire exists. The path table is the one shared
  contract in `flash-commons`; everything else there is behaviour and values that are not the API's contract.
- It buys one place to read or change the API surface, one name per route from the browser to the handler, no rewrite in
  the web server, and no drift between `flash-be` and `flash-web` by construction.
- The checks that hold it:
  - The tripwire, [`api-paths_tests.ts`](../../../libs/flash-commons/src/api-paths_tests.ts): `toEqual` against the whole
    table written as literal strings (`API_PREFIX`, `AUTH_BASE_PATH`, `PROBE_PATHS` and every `API_PATHS` entry). It also
    checks that every auth entry starts with `AUTH_BASE_PATH` (and that there are five), every `API_PATHS` entry starts
    with `/api/v1/`, and the probes do not start with `/api/`.
  - The route-table test of `flash-be`,
    [`routes/index_tests.ts`](../../../apps/flash-be/src/adapters/inbound/http/routes/index_tests.ts) (an `onRoute` hook
    over `registerRoutes`): the registered paths equal a list of literal expected paths, not read from the table.
  - A rule in [`architecture_tests.ts`](../../../apps/flash-be/src/architecture_tests.ts): no file in `routes/` writes a
    path literal. [`api-path-literals_tests.ts`](../../../apps/flash-web/src/api-path-literals_tests.ts) does the same for
    the clients, the loader and the proxy of `flash-web`.
  - Cookie tests: `Set-Cookie` for the refresh token has `Path=/api/v1/auth`, and the access cookie has `Path=/`. A scenario
    in `sessions.feature` states it, and a proxy test checks that the refresh cookie passes through unchanged.
  - Tests in `flash-web` (`api-paths_tests.ts`, `proxy_tests.ts`) check that no operator route is allowed and that
    `/sales/current` comes before the sale-id pattern.
  - Scenarios: a path without the version answers `404 not_found` on `flash-be` and on `flash-web`;
    `/api/v1/admin/sales` through `flash-web` answers `404 not_found`; `/health`, `/ready` and `/api/health` keep their
    paths.

## Revisit when

- A breaking change to a reply or a route is needed: add `/api/v2` next to `/api/v1` as a new record, keep v1 for as long as
  the page needs it, and give each version its own table.
- A mistake in the table gets past the tripwire and review: then the oracles need their own literals again.
- A client outside this repository is added: a path change then needs a deprecation step, not one coordinated edit.

## Related

- [006](006-browser-talks-to-web-server-only.md) (the proxy and its allow-list), [007](007-accounts-and-cookie-sessions.md)
  (the two cookies), [016](016-dry-rule-of-three.md) (where to put shared code, and its oracle rule, which this record narrows).
- [The web server in front of the API](../web-server-proxy.md), [authentication](../authentication.md) and the
  [HTTP endpoints](../../reference/http-endpoints.md).
- Code: [`libs/flash-commons/`](../../../libs/flash-commons/),
  [`cookies.ts`](../../../apps/flash-be/src/adapters/inbound/http/cookies.ts),
  [`routes/index.ts`](../../../apps/flash-be/src/adapters/inbound/http/routes/index.ts) and
  [`proxy.ts`](../../../apps/flash-web/src/proxy.ts).
