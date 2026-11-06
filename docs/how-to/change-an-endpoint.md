# Change an endpoint

Start from the contract, not from the handler. A change that skips the contract does not compile, or fails a test.

1. **Write the scenario first** in `specs/` when a shopper or an operator can see the change. See
   [add a behaviour](add-a-behaviour.md).
2. **Edit the contract** in `libs/contract/src`:
   - a new error code goes in `vocabulary.ts`, in `ERROR_STATUS`, in `ERROR_MESSAGE` (one sentence, which the compiler asks for) and in the list of the operations that may answer it;
   - a new body or reply shape goes in `schemas.ts`;
   - a new route, or a changed path, method or reply, goes in `routes.ts`.
3. **Run the contract tests.**

   ```bash
   npx nx test:quick contract
   ```

4. **Change the handler** in `apps/flash-be/src/adapters/inbound/http/routes.ts`. The type of the request and the type
   of every reply come from the route, so the compiler shows what is left to do.
5. **Regenerate the OpenAPI file** and commit it with the change.

   ```bash
   npm run openapi:generate
   npm run openapi:check
   ```

6. **Fix the consumers** that the compiler points at: `flash-web`, the e2e steps and `apps/flash-load/k6/shop.ts`. If the
   route should pass through the web server, set `passThrough` on it and the proxy follows.
7. **Run the checks** for the projects you touched.

   ```bash
   npx nx run-many -t test:quick -p contract flash-be flash-web
   npm run contract:guard:test
   ```

Do not write a path, a reply type or an error code for the API by hand in an app. `npm run contract:guard:test` fails
when product code writes an API path or the ticket header as a literal.
