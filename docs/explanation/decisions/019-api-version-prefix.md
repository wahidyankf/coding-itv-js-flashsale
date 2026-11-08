# 019: Every API route lives under `/api/v1`, and one path table in `flash-commons` names them all

## Status

Accepted. Every API route of `flash-be` is served under `/api/v1`, and the browser reaches the same path on `flash-web`. The
probes `/health` and `/ready` stay at the root. One module in `libs/flash-commons` is the only place product code writes an
API path.

## Context

The API had bare paths (`/sales/current`, `/auth/login`, `/admin/sales`), and the web server moved them under `/api` and
rewrote the refresh cookie from `/auth` to `/api/auth` so the browser would send it back. That gave one route two names, a
cookie rewrite to keep in step, and no room for a breaking change: a renamed field or route would break a page that is
already open. Paths were also written in each route file, in the web clients and in the proxy list, so a reader could not see
the whole surface in one place, and a change meant a search. The set of API paths is a contract that `flash-be` and
`flash-web` must agree on exactly.

## Decision

- **One prefix, `API_PREFIX = "/api/v1"`.** Every route of the sales, events, queue, reservation, purchase, auth and operator
  areas is served under it. `/health` and `/ready` are probes, not API. Compose, the Dockerfiles, nginx and the Playwright
  configs depend on them, so they stay unprefixed. `flash-web` keeps its own probe at `/api/health`. An unknown path, such as
  an old unprefixed one, gets the same `404 not_found` as before.
- **One path table, `libs/flash-commons/src/api-paths.ts`,** on the pure main entry of `@flash/flash-commons`. It exports
  `API_PREFIX`, `AUTH_BASE_PATH` (`/api/v1/auth`), `PROBE_PATHS` (`/health` and `/ready`) and `API_PATHS`, which names every
  route path: the sale, its events, the queue, the queue place and its events, reservations, purchases, the shopper's
  purchase, the five auth routes and the two operator paths. It holds paths only, with `:saleId` in a template, and no
  methods or handlers.
- **`flash-be` uses it,** in every route file and in `cookies.ts`. The route files write no path of their own.
  `REFRESH_COOKIE_PATH` becomes `AUTH_BASE_PATH`. The access cookie stays at `/`.
- **`flash-web` uses it,** in the page clients (`sale/client.ts`, `auth/client.ts`, `web-api.ts`), in the server-side sale
  loader and in the proxy. The proxy keeps its own ordered list of method and entry pairs, built from `API_PATHS`
  without the operator paths. The order matters, because `/sales/current` must come before the sale-id pattern. A client and
  the allow-list read the same entries, so they cannot name different paths. The proxy forwards the path unchanged: the
  browser path and the API path are now the same, and the cookie rewrite (`BACKEND_AUTH_PATH`) is removed.
- **No per-app path module and no path guard in `same_as_be_tests.ts`.** The compiler holds both apps to one source.
- **The oracles keep their own literal paths:** `flash-be-e2e`, `flash-web-e2e`, the k6 script and its runner, the prod smoke
  script and the `.http` files. They do not import the table, so a change to it fails them until each is updated by hand.
  This is an exception to the rule of the shared lib, and [016](016-dry-rule-of-three.md) records it.
- **No unprefixed alias.** There are no clients outside this repository.

### Threats

- The prefix is naming, not a security boundary. Authentication, the operator role check, the rate limits and the proxy
  allow-list are unchanged.
- The allow-list still fails closed. It lists only the shopper routes and its patterns are anchored on the full path, so
  `/api/v1/admin/sales` is refused by omission, and so is any path with an extra prefix. The test that fails if an operator
  route is on the list stays, written with the prefixed path.
- Sharing the table makes a wrong entry reach both apps at once. The oracles are the answer: they write the paths
  themselves, so a wrong or renamed entry fails the e2e run, the smoke run and the k6 run. The operator paths are
  never in the web list, and a test says so.
- The refresh token still reaches only the auth routes, because the cookie path is `AUTH_BASE_PATH`. Dropping the rewrite
  removes one place where the cookie path could drift from the real route.
- The sale path logic does not change, so the stock, the one-item rule and the Redis gate are untouched.

## Alternatives considered

- **No version in the path.** Cheapest, but the first breaking change then has nowhere to go.
- **A version in a header or a media type.** The version would be invisible in logs, in the `.http` files and in a browser
  address bar, and the proxy list matches on method and path only.
- **Keep the old paths as an alias.** It doubles the surface that tests and the allow-list must cover, to serve clients that
  do not exist.
- **Only a prefix constant, with each path written in its area file.** The paths stay spread over seven files, so the surface
  is harder to see and a change is a search.
- **Fastify `register(..., { prefix })`.** One line and no repetition, but the full path then appears nowhere in the code, so
  a reader cannot grep for it, and the cookie path and the web list would still need their own copy of the prefix.
- **One path module per app, guarded by `same_as_be_tests.ts`.** This was the first choice and follows the repository's
  pattern for a rule only `flash-be` and `flash-web` share ([016](016-dry-rule-of-three.md)). Rejected: the path set is a
  contract that both sides must agree on, so one compiled source enforces it better than a guard test. A copy can drift
  between two guard runs of a test that someone forgot to extend, and a shared source cannot.
- **A shared package whose constants the oracles also import.** A test that imports the server's paths cannot fail when the
  server changes them. The table is shared by the two product apps only, and the oracles keep their literals, so a renamed
  route still fails a test.
- **Keep `/api` on the web side and `/` on the API side.** This is the old setup. It needs the cookie rewrite and gives each
  route two names.

## Consequences

- It costs one edit per path in the table and in each oracle, and a long list of tests and docs that name a path. It also
  changes the layout rule "routes are in `routes/<area>.ts`, with full paths": the area files now use names from the table.
  The path table is a new shared contract in `flash-commons`, which until now held behaviour and values that are not the
  API's contract.
- It buys one place to read or change the API surface, one name per route from the browser to the handler, no cookie
  rewrite, and no drift between `flash-be` and `flash-web` by construction.
- Shoppers who are logged in at the time of the deploy keep the access cookie for up to 15 minutes. Their old refresh cookie
  has the path `/api/auth`, which no route uses now, so the next refresh fails and they log in again. It is a one-time cost,
  and the old cookie expires by itself.
- Deterministic checks the work must add:
  - A test in `libs/flash-commons` that writes the literal `/api/v1/` itself: every `API_PATHS` entry starts with it, every
    auth entry starts with `AUTH_BASE_PATH`, the probes do not start with it, and no entry is repeated.
  - A route-table test in `flash-be` (an `onRoute` hook over `registerRoutes`): the registered paths are exactly the
    `API_PATHS` values plus `PROBE_PATHS`.
  - A rule in `architecture_tests.ts`: no file in `routes/` writes a path literal. A similar test in `flash-web` for the
    clients, the loader and the proxy, which build every path from the table.
  - A rule in `architecture_tests.ts`: the e2e apps, `flash-load` and `scripts/smoke` do not import `API_PATHS`, `API_PREFIX`,
    `AUTH_BASE_PATH` or `PROBE_PATHS`, so the oracles stay independent.
  - Cookie tests: `Set-Cookie` for the refresh token has `Path=/api/v1/auth`, and the access cookie has `Path=/`. A scenario in
    `sessions.feature` states it. A proxy test that the refresh cookie passes through unchanged.
  - A proxy test that no operator entry is on the allow-list, with `/sales/current` listed before the sale-id pattern.
  - Scenarios: an old unprefixed path answers `404 not_found` on `flash-be` and on `flash-web`; `/api/v1/admin/sales` through
    `flash-web` answers `404 not_found`; `/health`, `/ready` and `/api/health` keep their paths.
  - `flash-load` (smoke first) must still pass, with its numbers and limits unchanged. Run it only after the current load run
    ends.

## Revisit when

- A breaking change to a reply or a route is needed: add `/api/v2` next to `/api/v1` as a new record, keep v1 for as long as
  the page needs it, and give each version its own table.
- A client outside this repository appears: it then needs a stated deprecation rule for old versions.
- A mistake in the table gets past the oracles: then the oracles are not independent enough.

## Related

- [006](006-browser-talks-to-web-server-only.md) (the proxy and its allow-list), [007](007-accounts-and-cookie-sessions.md)
  (the two cookies), [016](016-dry-rule-of-three.md) (where to put shared code, and the oracle rule).
- [The web server in front of the API](../web-server-proxy.md), [authentication](../authentication.md) and the
  [HTTP endpoints](../../reference/http-endpoints.md).
- Code: [`libs/flash-commons/`](../../../libs/flash-commons/),
  [`cookies.ts`](../../../apps/flash-be/src/adapters/inbound/http/cookies.ts),
  [`routes/index.ts`](../../../apps/flash-be/src/adapters/inbound/http/routes/index.ts) and
  [`proxy.ts`](../../../apps/flash-web/src/proxy.ts).
