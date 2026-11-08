# flash-web

The page a shopper uses: the sale status, log in or sign up, **Buy Now**, the hold countdown, **Confirm purchase** and
the answer. It is React on TanStack Start, styled with Tailwind classes. The browser talks only to this app's own web
server, which passes a fixed list of routes on to `flash-be`
([why](../../docs/explanation/decisions/006-browser-talks-to-web-server-only.md)).

## Where things are

```text
src/
  routes/            TanStack routes: the page (index.tsx), the document (__root.tsx), and the server routes under
                     /api: health.ts answers by itself, v1/auth.$.ts and v1/sales.$.ts hand every GET and POST to the proxy,
                     and $.ts sends every other /api path to the proxy, which refuses it with not_found
  api-paths.ts       BROWSER_ROUTES: the method and path pairs the browser may reach, in order, from API_PATHS in
                     @flash/flash-commons (no operator route)
  proxy.ts           checks a request against BROWSER_ROUTES, refuses a POST from another site, passes it on to flash-be
                     unchanged, keeps only some headers, and writes the caller's address and a new request id
  stream-closer.ts   the proxied event streams, kept so they can be ended when the server stops
  server-plugins/    Nitro runtime plugins, listed in vite.config.ts; end-streams.ts ends the proxied event streams
                     on SIGTERM or SIGINT, so a restart cuts no stream
  api.ts             what the app knows about the API: header names, the error shape, and callApi, which decodes
                     every reply with the decoder its caller names (the decoders sit next to the view types)
  web-api.ts         the one set of clients the page uses, sharing a fetch that renews the login
  config.ts          the settings the web server reads from its environment (server only)
  backend.ts         asks flash-be whether it is up, for the page's backend status
  router.tsx         the router, built from the generated routeTree.gen.ts
  error-text.ts      the sentence a shopper reads for each error code
  decode-report.ts   reports a reply or stream event that failed to decode: where, which field, what was expected
  sale-page.tsx      the page itself: where the sale and the account meet
  sale/              everything about the sale and buying
    shopper-state.ts   the rules of the buying card as pure functions (phase, countdown, text, Purchase ID line, which buttons work)
    use-shopper.ts     the hook that makes the requests and runs the effects
    messages.ts        the sale's words (TEXT) and its error sentences
    client.ts, sse.ts  the sale's calls and the live streams
    load.ts            the sale the server reads for the first render
    types.ts           the view types and their decoders
    *.tsx              the cards: status, stock meter, buy actions
  auth/              everything about the account: the form, its checks, its words, the account hook and client
  components/        look and parts shared by sale/ and auth/ (ui.ts holds the Tailwind class lists)
  bdd/               the Gherkin bindings of specs/apps/flash/web: each <feature>_tests.tsx (unit) and
                     <feature>_integration_tests.tsx names the scenarios; bdd/support holds the worlds, the fake backend,
                     one bind-<feature>.ts per feature that both layers run, and the shared steps (web-steps.ts)
  same_as_be_tests.ts  fails when a rule copied from flash-be drifts (user name, password, ticket header, two replies)
```

`sale/` and `auth/` never import each other. What both need lives directly in [`src/`](src).

## To add something

| To add …                                    | Put it in …                                                                                                                      | Also update …                                                                                                                                                                                                                                                              |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| a rule of the buying card                   | [`sale/shopper-state.ts`](src/sale/shopper-state.ts), with a test in [`shopper_state_tests.ts`](src/sale/shopper_state_tests.ts) | the scenario in [`specs/apps/flash/web/behaviours/`](../../specs/apps/flash/web/behaviours) if a shopper can see it                                                                                                                                                        |
| a sentence or a button label                | `TEXT` in [`sale/messages.ts`](src/sale/messages.ts) (or `AUTH_TEXT` in [`auth/messages.ts`](src/auth/messages.ts))              | the locators of `flash-web-e2e` if they read it                                                                                                                                                                                                                            |
| the text of a new error code                | [`error-text.ts`](src/error-text.ts), or the area's `messages.ts`                                                                | `flash-be`'s [`errors.ts`](../flash-be/src/adapters/inbound/http/errors.ts) already names the code                                                                                                                                                                         |
| a call to a new API route                   | [`sale/client.ts`](src/sale/client.ts) or [`auth/client.ts`](src/auth/client.ts)                                                 | its path in `API_PATHS` ([`api-paths.ts`](../../libs/flash-commons/src/api-paths.ts) in flash-commons), `BROWSER_ROUTES` in [`api-paths.ts`](src/api-paths.ts), [`api-flash-web.http`](../../api-flash-web.http), [HTTP endpoints](../../docs/reference/http-endpoints.md) |
| a part of the page                          | a component in `sale/` or `auth/`; a shared one in `components/`                                                                 | classes in [`components/ui.ts`](src/components/ui.ts) when two parts share a look                                                                                                                                                                                          |
| a value used by 3 or more places in the app | one named constant or function in the folder that owns it                                                                        | when other apps use it in 3+ places too, `libs/flash-commons` ([rule](../../docs/explanation/decisions/016-dry-rule-of-three.md))                                                                                                                                          |
| a behaviour                                 | a scenario first, then bindings in [`src/bdd/`](src/bdd)                                                                         | `npm run bdd:check` ([how](../../docs/how-to/add-a-behaviour.md))                                                                                                                                                                                                          |

## Commands

```bash
npx nx dev flash-web             # the page on :3000 (start flash-be first)
npx nx test:quick flash-web      # typecheck, lint, unit tests
npx nx test:integration flash-web
npx nx test:coverage flash-web   # unit and integration, 99% floor
```
