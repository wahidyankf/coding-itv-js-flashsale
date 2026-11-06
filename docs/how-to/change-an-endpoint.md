# Change an endpoint

The API is plain code. There is no shared contract library, so a change goes to every place that writes the route.

1. **Write the scenario first** in `specs/` when a shopper or an operator can see the change. See
   [add a behaviour](add-a-behaviour.md).
2. **Change the handler** in `apps/flash-be/src/adapters/inbound/http/routes.ts`. A new error code goes in
   `adapters/inbound/http/errors.ts`, in `ERROR_STATUS` and in `ERROR_MESSAGE` (one sentence; the compiler asks for it), and
   in the error type of the service that can answer it.
3. **Fix the callers** by searching for the path: `apps/flash-web` (the client in `src/sale/client.ts`, and the allow-list of
   the proxy in `src/proxy.ts` if the route should pass through the web server), the e2e steps, `apps/flash-load/k6/shop.ts`
   and `scripts/smoke/prod.mjs`. If the web page shows a new error code, add its text to `apps/flash-web/src/sale/messages.ts`.
4. **Update the docs:** the route in [HTTP endpoints](../reference/http-endpoints.md), and the manual requests in
   `api-flash-be.http` and `api-flash-web.http`.
5. **Run the checks** for the projects you touched.

   ```bash
   npx nx run-many -t test:quick -p flash-be flash-web
   npm run bdd:check
   ```
