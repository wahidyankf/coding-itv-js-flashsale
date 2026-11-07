# React and TanStack Start crash course

React draws the page of `flash-web` from components and hooks. TanStack Start runs that page on a server: it renders the
first HTML, gives the app its own server routes, and is built by Vite with Nitro as the Node server. TanStack Router,
part of Start, maps files in `src/routes/` to addresses.

## Why this repo uses it

**The problem.** A shopper opens the page at the moment a sale starts. The first paint must already show the status and
the items left, so the page renders on the server from the current sale. After that the browser follows the sale live.
The browser must also never see the API: its address stays on the server, and only a fixed list of routes gets through
([decision 006](../../explanation/decisions/006-browser-talks-to-web-server-only.md)). Start gives both in one app: a
loader that runs on the server, and server routes under `/api` that hold the proxy.

**What we did not pick.** No record compares frameworks. Decision 006 rejects the browser calling the API directly, and
server functions that call the API with no proxy (streams and cookies would need their own handling).
[Decision 004](../../explanation/decisions/004-hexagon-in-the-api-only.md) rejects a hexagon with ports inside
`flash-web`: it would have one API and nothing to isolate.

**What it costs.** Every request has one more hop through the web server
([why it is worth it](../../explanation/web-server-proxy.md)). The route tree is a generated file. Nitro is pinned to a
release candidate (`3.0.261103-rc` in [package.json](../../../apps/flash-web/package.json)), and the order of the Vite
plugins matters.

## The ideas this repo uses

### File routes and the generated tree

Each file in [`src/routes/`](../../../apps/flash-web/src/routes/) is a route: `index.tsx` is `/`, `api/health.ts` is
`/api/health`, and `$` in `api/sales.$.ts` matches the rest of the path. The Vite plugin writes
[`routeTree.gen.ts`](../../../apps/flash-web/src/routeTree.gen.ts) from them, and
[`router.tsx`](../../../apps/flash-web/src/router.tsx) builds a new router per request from that tree. Do not edit the
generated file; Biome and the coverage skip it.

### The root document

[`__root.tsx`](../../../apps/flash-web/src/routes/__root.tsx) owns `<html>`, the head and the stylesheet. Every page
renders inside its `<Outlet />`, which arrives here as `children`:

```tsx
function RootDocument({ children }: Readonly<{ children: ReactNode }>) {
	return (
		<html lang="en">
			<head>
				<HeadContent />
			</head>
			<body className="min-h-screen bg-stone-50 ... dark:text-slate-200">
				{children}
				<Scripts />
			</body>
		</html>
	);
}
```

### A loader that reads on the server

[`routes/index.tsx`](../../../apps/flash-web/src/routes/index.tsx) wraps the read in `createServerFn`, so
`process.env` is read on the server only and never reaches the browser bundle. The loader calls it before the page
renders. [`sale/load.ts`](../../../apps/flash-web/src/sale/load.ts) tells "no sale" apart from "could not read it":

```tsx
const getHomeData = createServerFn({ method: "GET" }).handler(homeDataHandler);

export const Route = createFileRoute("/")({
	loader: () => getHomeData(),
	pendingComponent: HomePending,
	component: () => {
		const { status, sale } = Route.useLoaderData();
		return <HomePage status={status} sale={sale} />;
	},
});
```

### Server routes that call the proxy

A route with `server.handlers` answers HTTP itself and renders nothing.
[`api/sales.$.ts`](../../../apps/flash-web/src/routes/api/sales.$.ts) hands every request to
[`proxy.ts`](../../../apps/flash-web/src/proxy.ts), which checks it against the allow-list:

```ts
export const Route = createFileRoute("/api/sales/$")({
	server: {
		handlers: {
			GET: ({ request }) => proxyToBackend(request, process.env),
			POST: ({ request }) => proxyToBackend(request, process.env),
		},
	},
});
```

### Pure state, and a hook for the effects

[`sale/shopper-state.ts`](../../../apps/flash-web/src/sale/shopper-state.ts) holds the rules of the buying card as plain
functions over a `Phase` union, with no React, so a test just calls them.
[`sale/use-shopper.ts`](../../../apps/flash-web/src/sale/use-shopper.ts) keeps the requests, the timers and the streams
in `useState`, `useEffect` and `useCallback`, and returns the text from the pure part:

```ts
return { phase, text: phaseText(phase, secondsLeft(phase, clock)), buy, confirm, check };
```

### Live streams in the browser

The page follows the sale over Server-Sent Events, but not with `EventSource`: it cannot send the queue ticket header.
[`sale/sse.ts`](../../../apps/flash-web/src/sale/sse.ts) reads the stream with `fetch`, and
[`sale-page.tsx`](../../../apps/flash-web/src/sale-page.tsx) opens it in an effect whose cleanup stops it:

```tsx
useEffect(() => {
	if (!id) return;
	return client.watchSale(id, setSale, onStopped);
}, [id, client, onStopped]);
```

### Every reply is decoded

`callApi` in [`api.ts`](../../../apps/flash-web/src/api.ts) returns a `Result`, and a 2xx reply counts only when the
decoder accepts its body ([decision 018](../../explanation/decisions/018-decode-payloads-at-the-edge.md)). Stream events
are decoded the same way in [`sale/client.ts`](../../../apps/flash-web/src/sale/client.ts).

### Vite, Nitro and component tests

[`vite.config.ts`](../../../apps/flash-web/vite.config.ts) lists `tanstackStart()`, then `nitro()`, then the React plugin,
then Tailwind. Components are tested with Testing Library in jsdom, next to the source, as in
[`sale-time_tests.tsx`](../../../apps/flash-web/src/components/sale-time_tests.tsx). Call `cleanup` in `afterEach`.

## Try it here

Start the page, and keep it running:

```bash
npx nx dev flash-web
```

In a second terminal, ask its server routes. The API was not running, so the proxy answers `502`:

```bash
curl localhost:3000/api/health
curl localhost:3000/api/sales/current
curl localhost:3000/api/sales/not-a-uuid
```

```text
{"status":"ok"}
{"errorCode":"backend_unavailable","errorMessage":"The API could not be reached."}
{"errorCode":"not_found","errorMessage":"Nothing was found at this address."}
```

The home page still renders, and says `Backend: down`. Stop the dev page with Ctrl+C. Then run the pure rules and a
component test from `apps/flash-web`:

```bash
cd apps/flash-web
npx vitest run --config vitest.config.ts src/sale/shopper_state_tests.ts src/components/sale-time_tests.tsx --reporter=verbose
```

```text
 ✓ |unit| src/sale/shopper_state_tests.ts > secondsLeft > counts the seconds of a hold, rounding a part second up
 ✓ |unit| src/components/sale-time_tests.tsx > SaleTime > is first written in UTC, so the server and the browser agree
 Test Files  2 passed (2)
      Tests  21 passed (21)
```

## Traps we hit

- **The refresh cookie path.** `flash-be` sets the refresh cookie for `/auth`, but the browser reaches it as `/api/auth`
  and would never send it back. `rewritePath` in [`proxy.ts`](../../../apps/flash-web/src/proxy.ts) moves it.
- **A callback that changes every render.** `onLiveStopped` must be stable (`useCallback`), or the effect in
  [`sale-page.tsx`](../../../apps/flash-web/src/sale-page.tsx) opens the stream again on every render.
- **Server and browser text that differ.** [`sale-time.tsx`](../../../apps/flash-web/src/components/sale-time.tsx)
  writes the time in UTC first, the same on both sides, and switches to local time in an effect.
- **A stream that keeps failing.** [`sse.ts`](../../../apps/flash-web/src/sale/sse.ts) retries with backoff and jitter
  and gives up after 8 failed attempts in a row, then the page says its live updates stopped
  ([retry policies](../../reference/retry-policies.md)). A frame that does not decode does not count as alive.

## Read next

- [React](https://react.dev/) (19), [TanStack Start](https://tanstack.com/start/latest/docs/framework/react/overview):
  [server functions](https://tanstack.com/start/latest/docs/framework/react/guide/server-functions) and
  [server routes](https://tanstack.com/start/latest/docs/framework/react/guide/server-routes),
  [file-based routing](https://tanstack.com/router/latest/docs/framework/react/routing/file-based-routing),
  [React Testing Library](https://testing-library.com/docs/react-testing-library/intro/).
- [flash-web README](../../../apps/flash-web/README.md), [live updates](../../explanation/live-updates.md),
  [Tailwind CSS crash course](tailwind-css.md) and [typekit crash course](typekit.md).
