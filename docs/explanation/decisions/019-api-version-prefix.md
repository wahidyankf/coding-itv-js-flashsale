# 019: Every API route lives under `/api/v1`, and each app keeps its paths in one module

## Status

Accepted. Every API route of `flash-be` is served under `/api/v1`, and the browser reaches the same path on `flash-web`. The
probes `/health` and `/ready` stay at the root. In each app, one module is the only place product code writes an API path.

## Context

The API had bare paths (`/sales/current`, `/auth/login`, `/admin/sales`), and the web server moved them under `/api` and
rewrote the refresh cookie from `/auth` to `/api/auth` so the browser would send it back. That gave one route two names, a
cookie rewrite to keep in step, and no room for a breaking change: a renamed field or route would break a page that is
already open. Paths were also written in each route file, in the web clients and in the proxy list, so a reader could not see
the whole surface in one place, and a change meant a search.

## Decision

- **One prefix, `API_PREFIX = "/api/v1"`.** Every route of the sales, events, queue, reservation, purchase, auth and operator
  areas is served under it. `/health` and `/ready` are probes, not API. Compose, the Dockerfiles, nginx and the Playwright
  configs depend on them, so they stay unprefixed. `flash-web` keeps its own probe at `/api/health`. An unknown path, such as
  an old unprefixed one, gets the same `404 not_found` as before.
- **`flash-be` has one route-path module,** `apps/flash-be/src/adapters/inbound/http/paths.ts`. It exports `API_PREFIX` and
  every route path (the sale, its events, the queue, the queue place and its events, reservations, purchases, the shopper's
  purchase, the five auth routes and the two operator paths), and the two probe paths. The route files use these names
  and write no path of their own. It sits beside `errors.ts`, `headers.ts` and `cookies.ts`, not under `routes/`, because the
  cookie code needs it too and `routes/` already imports from the folder above it.
- **The refresh cookie path is derived from the table:** `REFRESH_COOKIE_PATH` becomes the auth base path, `/api/v1/auth`, taken
  from `paths.ts`. The access cookie stays at `/`.
- **`flash-web` has one module,** `apps/flash-web/src/api-paths.ts`. The page clients (`sale/client.ts`, `auth/client.ts`,
  `web-api.ts`), the server-side sale loader and the proxy allow-list all read it. A client builds its URL from an entry, and
  the proxy builds its pattern from the same entry, so the page and the allow-list cannot name different paths. The operator
  paths are not in it. The proxy forwards the path unchanged: the browser path and the API path are now the same, and the
  cookie rewrite (`BACKEND_AUTH_PATH`) is removed.
- **A guard in `same_as_be_tests.ts`** fails when the web list is not exactly the `flash-be` list without the operator paths
  and the probes. This is the repository's pattern for a rule only these two apps share ([016](016-dry-rule-of-three.md)): no
  product code imports across apps.
- **The oracles keep their own literal paths:** `flash-be-e2e`, `flash-web-e2e`, the k6 script and its runner, the prod smoke
  script and the `.http` files. A change to a path table fails them until each is updated by hand.
- **No unprefixed alias.** There are no clients outside this repository.

### Threats

- The prefix is naming, not a security boundary. Authentication, the operator role check, the rate limits and the proxy
  allow-list are unchanged.
- The allow-list still fails closed. Its patterns are anchored on the full path, so `/api/v1/admin/sales` is refused by
  omission, and so is any path with an extra prefix. The test that fails if an operator route is on the list stays, now
  written with the prefixed path.
- The refresh token still reaches only the auth routes, because the cookie path is the auth base path. Dropping the rewrite
  removes one place where the cookie path could drift from the real route.
- The sale path logic does not change, so the stock, the one-item rule and the Redis gate are untouched.

## Alternatives considered

- **No version in the path.** Cheapest, but the first breaking change then has nowhere to go.
- **A version in a header or a media type.** The version would be invisible in logs, in the `.http` files and in a browser
  address bar, and the proxy list matches on method and path only.
- **Keep the old paths as an alias.** It doubles the surface that tests and the allow-list must cover, to serve clients that
  do not exist.
- **Only a prefix constant, with each path written in its area file.** The paths stay spread over seven files, so the surface
  is harder to see and a change is a search. Rejected for the one table.
- **Fastify `register(..., { prefix })`.** One line and no repetition, but the full path then appears nowhere in the code, so
  a reader cannot grep for it, and the cookie path and the web list would still need their own copy of the prefix. The table
  keeps the full path in one visible place.
- **One shared path package for both apps, or imports across apps.** A test that imports the server's paths cannot fail when
  the server changes them, and the rule is only shared by two apps ([016](016-dry-rule-of-three.md)).
- **Keep `/api` on the web side and `/` on the API side.** This is the old setup. It needs the cookie rewrite and gives each
  route two names.

## Consequences

- It costs one edit per path in the table and in each oracle, and a long list of tests and docs that name a path. It also
  changes the layout rule "routes are in `routes/<area>.ts`, with full paths": the area files now use names from `paths.ts`.
- It buys one place per app to read or change the API surface, one name per route end to end, and no cookie rewrite.
- Shoppers who are logged in at the time of the deploy keep the access cookie for up to 15 minutes. Their old refresh cookie
  has the path `/api/auth`, which no route uses now, so the next refresh fails and they log in again. It is a one-time cost,
  and the old cookie expires by itself.
- Deterministic checks the work must add:
  - A route-table test in `flash-be` (an `onRoute` hook over `registerRoutes`): the registered paths are exactly the paths of
    `paths.ts` plus the probes. The test writes the literal `/api/v1/` itself, and every path but the probes starts with it.
  - A rule in `architecture_tests.ts`: no file in `routes/`, other than the probe file, writes a path literal.
  - Cookie tests: `Set-Cookie` for the refresh token has `Path=/api/v1/auth`, and the access cookie has `Path=/`. A scenario in
    `sessions.feature` states it.
  - Scenarios: an old unprefixed path answers `404 not_found` on `flash-be` and on `flash-web`; `/api/v1/admin/sales` through
    `flash-web` answers `404 not_found`; `/health`, `/ready` and `/api/health` keep their paths.
  - `same_as_be_tests.ts`: the table guard above. A proxy test that the refresh cookie passes through unchanged.
  - `flash-load` (smoke first) must still pass, with its numbers and limits unchanged. Run it only after the current load run
    ends.

## Revisit when

- A breaking change to a reply or a route is needed: add `/api/v2` next to `/api/v1` as a new record, keep v1 for as long as
  the page needs it, and give each version its own table.
- A client outside this repository appears: it then needs a stated deprecation rule for old versions.
- A third app uses the paths: the table may then belong in `libs/flash-commons`, with the oracles still writing literals.

## Related

- [006](006-browser-talks-to-web-server-only.md) (the proxy and its allow-list), [007](007-accounts-and-cookie-sessions.md)
  (the two cookies), [016](016-dry-rule-of-three.md) (copies, guards and oracles).
- [The web server in front of the API](../web-server-proxy.md), [authentication](../authentication.md) and the
  [HTTP endpoints](../../reference/http-endpoints.md).
- Code: [`cookies.ts`](../../../apps/flash-be/src/adapters/inbound/http/cookies.ts),
  [`routes/index.ts`](../../../apps/flash-be/src/adapters/inbound/http/routes/index.ts),
  [`proxy.ts`](../../../apps/flash-web/src/proxy.ts) and
  [`same_as_be_tests.ts`](../../../apps/flash-web/src/same_as_be_tests.ts).
