# Change an endpoint

The API is plain code. Its paths are named once in
[`libs/flash-commons/src/api-paths.ts`](../../libs/flash-commons/src/api-paths.ts), and every app imports them. The
shapes of the replies have no shared contract, so a change to a reply goes to every caller that reads it.

1. **Write the scenario first** in [`specs/`](../../specs) when a shopper or an operator can see the change. See
   [add a behaviour](add-a-behaviour.md).
2. **Change the path, if it changes,** in `API_PATHS` in
   [`api-paths.ts`](../../libs/flash-commons/src/api-paths.ts), under `/api/v1`. Edit the literal tables in
   [`api-paths_tests.ts`](../../libs/flash-commons/src/api-paths_tests.ts) and
   [`routes/index_tests.ts`](../../apps/flash-be/src/adapters/inbound/http/routes/index_tests.ts) by hand too: they are
   there so a renamed path is a change a reviewer sees
   ([decision 019](../explanation/decisions/019-api-version-prefix.md)).
3. **Change the handler** in `apps/flash-be/src/adapters/inbound/http/routes/<area>.ts` (a new area is registered in
   [`routes/index.ts`](../../apps/flash-be/src/adapters/inbound/http/routes/index.ts)). A new error code goes in
   [`adapters/inbound/http/errors.ts`](../../apps/flash-be/src/adapters/inbound/http/errors.ts), in `ERROR_STATUS` and in `ERROR_MESSAGE` (one sentence; the compiler asks for it), and
   in the error type of the service that can answer it.
4. **Fix the callers** that read the reply, by searching for the name in `API_PATHS`: `apps/flash-web` (the clients in [`src/sale/client.ts`](../../apps/flash-web/src/sale/client.ts) and [`src/auth/client.ts`](../../apps/flash-web/src/auth/client.ts), and
   `BROWSER_ROUTES` in [`src/api-paths.ts`](../../apps/flash-web/src/api-paths.ts) if the route should pass through the web server), the e2e steps, [`apps/flash-load/k6/shop.ts`](../../apps/flash-load/k6/shop.ts)
   and [`scripts/smoke/prod.mjs`](../../scripts/smoke/prod.mjs). If the web page shows a new error code, add its text to [`apps/flash-web/src/error-text.ts`](../../apps/flash-web/src/error-text.ts)
   ([`sale/messages.ts`](../../apps/flash-web/src/sale/messages.ts) and [`auth/messages.ts`](../../apps/flash-web/src/auth/messages.ts) hold the text of each area).
5. **Update the docs:** the route in [HTTP endpoints](../reference/http-endpoints.md), the manual requests in
   [`api-flash-be.http`](../../api-flash-be.http) and [`api-flash-web.http`](../../api-flash-web.http), and [`api-flash-demo.http`](../../api-flash-demo.http) with [the demo](run-the-demo.md) if the
   demo sends the route.
6. **Run the checks** for the projects you touched.

   ```bash
   npx nx run-many -t test:quick -p flash-commons flash-be flash-web
   npm run bdd:check
   ```
