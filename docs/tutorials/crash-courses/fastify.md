# Fastify crash course

Fastify is an HTTP server framework for Node.js. In this repository it is the HTTP edge of `flash-be`: it turns a request
into a call on the application and a result into a reply. This page explains why it is used here and how. The official
docs teach the rest.

## Why this repo uses it

**The problem.** In a rush, thousands of shoppers send short requests (join the queue, reserve, pay), and every open page
keeps a long event stream open. Each write route must check the login and the rate limit before it does any work. The
sale rules must be testable without a port, a database or Redis.

**What Fastify gives us here.** A route table where each route names its own guards as hooks, `inject` to call the app in
a test without opening a port, and the raw Node response for Server-Sent Events.

**What we did not pick.** No decision record compares Fastify with other servers. The choices around it are recorded:

- The hexagon keeps Fastify in the inbound adapter only ([004](../../explanation/decisions/004-hexagon-in-the-api-only.md)).
- Live updates are Server-Sent Events, not WebSockets ([008](../../explanation/decisions/008-server-sent-events.md)).
- Bodies are decoded by our small kit in the route, not by a schema library such as Zod
  ([018](../../explanation/decisions/018-decode-payloads-at-the-edge.md)). No route has a Fastify JSON schema.
- No Fastify plugin is installed. The cookies are written and read by about 60 lines in
  [`cookies.ts`](../../../apps/flash-be/src/adapters/inbound/http/cookies.ts).

**What it costs us.** Without schemas there is no generated OpenAPI file; the routes are listed by hand in
[HTTP endpoints](../../reference/http-endpoints.md). The event stream, the guards and the cookies are our own code to keep.

## The ideas this repo uses

### One app, routes registered by area

[`buildApp`](../../../apps/flash-be/src/adapters/inbound/http/app.ts) makes the app without listening, so the entry point
and the tests build the same thing. [`routes/index.ts`](../../../apps/flash-be/src/adapters/inbound/http/routes/index.ts)
calls one `register...Routes` per area, and each route is declared with `app.route` and its full path:

```ts
const app = Fastify({
	...(options.logger === undefined
		? { logger: false }
		: { loggerInstance: options.logger }),
	// The header is read in requestIdOf, not by Fastify, which would take any value it holds.
	requestIdHeader: false,
	genReqId: requestIdOf,
	trustProxy: options.trustProxy ?? false,
	// A close drops only idle connections and waits for the requests in flight.
	forceCloseConnections: "idle",
	// A request that still reaches a closing server is answered as usual, so every error keeps the API's body.
	return503OnClosing: false,
});
const isStopping = options.isStopping ?? (() => false);
const open = createOpenStreams();
answerErrors(app);
closeGracefully(app, isStopping, open.endAll);

registerRoutes(
	app,
	deps,
	{ ...(options.events ?? DEFAULT_STREAM_OPTIONS), open },
	{ secure: options.cookieSecure, isStopping },
);
```

The logger comes from `createLogger` in the same file, which sets the level and hides the cookie and authorization
headers. `main.ts` makes it first, so the `flash-be config` line is written before Redis connects, and passes the same
instance in.

`answerErrors` sets `setNotFoundHandler` and `setErrorHandler`, so every error has the body `{ errorCode, errorMessage }`.
An error that Fastify raises with a `4xx` `statusCode` becomes `invalid_request`; anything else is `internal`, logged, and
its cause is not sent.

### Hooks as guards

A route runs its hooks before its handler. If a hook sends a reply, the handler never runs. The guards are built once
from the application in [`guards.ts`](../../../apps/flash-be/src/adapters/inbound/http/routes/guards.ts), and each route
takes the ones it needs ([`queue.ts`](../../../apps/flash-be/src/adapters/inbound/http/routes/queue.ts)):

```ts
app.route<{ Params: SaleParams }>({
	method: "POST",
	url: API_PATHS.queue,
	preValidation: limit,
	handler: async (request, reply) =>
		sendResult(
			reply,
			await deps.queue.join(request.params.saleId, shopperOf(request)),
			// The ticket sits between the user and the place, which keeps the key order of the reply.
			({ created, user, ticket, place }) =>
				createdOrOk(reply, created).send({ userId: user, ticket, ...place }),
		),
});
```

The operator routes in [`admin.ts`](../../../apps/flash-be/src/adapters/inbound/http/routes/admin.ts) use `onRequest`
with the same two guards on every route: `const guarded = [limitAdmin, needOperator]`, then `onRequest: guarded`. `onRequest` runs before the body is read, so a client without the
login learns nothing from a broken body. A guard that lets a request through keeps the login in a `WeakMap`, and the
handler reads it with `principalOf` or `shopperOf`.

### Reply helpers

A route never picks a status by hand for an error. [`reply.ts`](../../../apps/flash-be/src/adapters/inbound/http/routes/reply.ts)
turns a `Result` from the application into a reply, and the status of each error code lives in `ERROR_STATUS` in
[`errors.ts`](../../../apps/flash-be/src/adapters/inbound/http/errors.ts):

```ts
export function sendResult<T, E extends ErrorCode>(
	reply: FastifyReply,
	result: Result<T, E>,
	onOk: (value: T) => FastifyReply,
): FastifyReply {
	return result.isErr() ? sendError(reply, result.error) : onOk(result.value);
}
```

`createdOrOk` answers `201` for a new thing and `200` for a retry that finds it already there.

### Cookies without a plugin

The login sets two `Set-Cookie` headers with `reply.header("set-cookie", [...])`
([`auth.ts`](../../../apps/flash-be/src/adapters/inbound/http/routes/auth.ts)). `setCookie` in [`cookies.ts`](../../../apps/flash-be/src/adapters/inbound/http/cookies.ts) always adds
`HttpOnly` and `SameSite=Lax`, and `Secure` when the config asks. `cookieValue` reads one cookie from the `Cookie`
header. Why the session uses cookies is in [authentication](../../explanation/authentication.md).

### A stream on the raw response

[`serveEvents`](../../../apps/flash-be/src/adapters/inbound/http/event-stream.ts) calls `reply.hijack()`, which tells
Fastify that the code writes the reply itself. It then writes the headers and the events on `reply.raw`, and stops when
the request closes:

```ts
reply.hijack();
const raw = reply.raw;
raw.writeHead(HTTP_STATUS.ok, {
	"content-type": "text/event-stream",
	// ... cache-control, connection and x-accel-buffering ...
});
// ... the read loop ...
request.raw.on("close", () => {
	stop(); // closed = true, and the next read is not scheduled
	forget(); // the stream leaves the set that a shutdown ends
});
```

What a stream sends and when is in [live updates](../../explanation/live-updates.md).

### `inject` in tests

`app.inject` sends a fake request through the whole app, hooks included, with no port. The tests in
[`app_tests.ts`](../../../apps/flash-be/src/adapters/inbound/http/app_tests.ts) build the app over fake dependencies:

```ts
const reply = await app.inject({
	method: "GET",
	url: "/api/v1/sales/current",
});
expect(reply.statusCode).toBe(500);
expect(reply.json()).toEqual(errorPayload("internal"));
```

### An inbound adapter of the hexagon

Only `adapters/inbound/http` imports `fastify`. A route reads the request, calls one service from `Dependencies`, and
shapes the reply; the rules are in `src/domain`. [`architecture_tests.ts`](../../../apps/flash-be/src/architecture_tests.ts) fails if the application imports `fastify`. See
[hexagonal architecture](../../explanation/hexagonal-architecture.md).

## Try it here

The HTTP unit tests need no Docker. From the repository root:

```bash
cd apps/flash-be
npx vitest run --config vitest.config.ts src/adapters/inbound/http/app_tests.ts -t "cookies of a login" --reporter=verbose
```

The output, trimmed:

```text
 ✓ |unit| src/adapters/inbound/http/app_tests.ts > the cookies of a login > sends the tokens only as HttpOnly cookies, never in the body 38ms
 ✓ |unit| src/adapters/inbound/http/app_tests.ts > the cookies of a login > records the address and the cut user agent of the login, and none when the client sends none 4ms
 ✓ |unit| src/adapters/inbound/http/app_tests.ts > the cookies of a login > adds Secure when the cookies are for HTTPS only 4ms
      Tests  3 passed | 21 skipped (24)
```

Each of these tests sends a login with `app.inject` and reads the `set-cookie` headers of the reply.

## Traps to avoid

- **Open streams keep the server open.** `app.close()` waits for every connection that is not idle, and an event stream
  is never idle. `forceCloseConnections: true` would cut it, and every request in flight with it. So
  [`app.ts`](../../../apps/flash-be/src/adapters/inbound/http/app.ts) closes only idle connections (`"idle"`) and ends
  the open streams itself in a `preClose` hook.
- **`requestIdHeader` trusts the header as sent.** Fastify uses a set header's raw value without calling `genReqId`, so
  junk would reach the logs. `app.ts` turns it off and reads the header inside `genReqId`, keeping only a UUID.
- **`preValidation` runs after the body is parsed.** A guard that must run before the body is read goes in `onRequest`,
  as the admin and auth routes do.
- **After `reply.hijack()`, Fastify sends nothing.** An error after that point cannot be a JSON reply. So a stream route
  checks the request first and calls `sendError` before it calls `serveEvents`, as the place stream in [`queue.ts`](../../../apps/flash-be/src/adapters/inbound/http/routes/queue.ts) does.
- **`request.ip` behind a proxy.** Without `trustProxy` every shopper behind nginx has the address of nginx, and the rate
  limit counts them as one. `TRUST_PROXY` turns it on, only behind a proxy you control ([`config.ts`](../../../apps/flash-be/src/config.ts)).

## Read next

- Fastify v5.12 docs: [Routes](https://fastify.dev/docs/v5.12.x/Reference/Routes/),
  [Hooks](https://fastify.dev/docs/v5.12.x/Reference/Hooks/), [Reply](https://fastify.dev/docs/v5.12.x/Reference/Reply/)
  and [Testing](https://fastify.dev/docs/v5.12.x/Guides/Testing/).
- [Hexagonal architecture](../../explanation/hexagonal-architecture.md), [rate limiting](../../explanation/rate-limiting.md)
  and [live updates](../../explanation/live-updates.md).
- [Change an endpoint](../../how-to/change-an-endpoint.md) and [HTTP endpoints](../../reference/http-endpoints.md).
- [`libs/typekit/README.md`](../../../libs/typekit/README.md) for `Result`, which every reply helper takes.
