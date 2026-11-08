# 006: The browser talks only to the web server

## Status

Accepted. `flash-web` passes sale and login calls to the API through an allow-list. The browser never sees the API.

## Context

The page needs the API, and the API has routes that a shopper must never reach: the operator routes under `/api/v1/admin/sales`,
and the health checks. A browser that calls the API directly needs its address, CORS rules and a public API.

## Decision

- The page calls its own server under `/api/v1/sales` and `/api/v1/auth`. The server passes on a list of method and path pairs
  (`BROWSER_ROUTES` in [`api-paths.ts`](../../../apps/flash-web/src/api-paths.ts), checked in [`proxy.ts`](../../../apps/flash-web/src/proxy.ts)) and answers `404 not_found` to the rest. A sale id must be a UUID.
- `FLASH_BE_URL` is read on the server only. Only the headers the API needs go on. The path and the cookies pass
  unchanged, because the browser and the API use the same paths. A POST from another origin gets `403 cross_site`. If the API cannot be reached the answer is `502 backend_unavailable`.
- The operator routes are not on the list, and a test in [`proxy_tests.ts`](../../../apps/flash-web/src/proxy_tests.ts) fails if one is.

## Alternatives considered

- **The browser calls the API directly.** It needs CORS, a public API address, and every route open to the internet,
  including `/api/v1/admin`. One missed check would expose an operator route.
- **A full pass-through proxy.** It is simpler, but then a path such as `../ready` or `/api/v1/admin/sales` reaches the API.
- **A deny-list of operator routes.** A new route would be open until someone remembers to block it. An allow-list fails closed.
- **Server functions that call the API in code, with no proxy.** Streams (Server-Sent Events) and cookies would need their own handling.

## Consequences

- It costs one more hop on each request, and a list to update with each public route. The proxy streams answers as they
  arrive, so event streams are not buffered.
- It buys one origin (no CORS rules to get wrong), a private API address, and a small public surface. The per-address
  rate limit sees the web server's address for every page shopper. The per-user limit still applies.

## Revisit when

- The API is meant to be public, for another client: it then needs CORS, its own limits and its own review.
- The extra hop shows in measured latency. The web server is stateless, so it can be scaled before it is removed.

## Related

- [The web server in front of the API](../web-server-proxy.md) and [authentication](../authentication.md).
- Code: [`proxy.ts`](../../../apps/flash-web/src/proxy.ts) and [`proxy_tests.ts`](../../../apps/flash-web/src/proxy_tests.ts).
