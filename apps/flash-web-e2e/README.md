# flash-web-e2e

Playwright tests of the page in a real browser. Each scenario of
[specs/apps/flash/web](../../specs/apps/flash/web/README.md) that is not `@e2e-exempt` runs here against the built web
server, which reaches a real `flash-be` through a forwarder the tests can cut.

## Where things are

```text
steps/
  <area>.steps.ts    the step definitions, one file per area of the feature files
  support/
    shop.ts            the scenario's side of the web server: which flash-be it reaches, the sale, the shoppers
    forwarder.ts       the forwarder in front of flash-be (pass on, cut, or answer with a canned reply)
    api.ts             the path of a sale and the request helpers
```

Helpers that the API tests also need (time, logins, the database, the reply holder, the relay) come from
[`flash-be-e2e/steps/support`](../flash-be-e2e/README.md). They are not copied here.

## To add something

| To add …                     | Put it in …                               | Also update …        |
| ---------------------------- | ----------------------------------------- | -------------------- |
| a step                       | the `<area>.steps.ts` of its feature file | `npm run bdd:check`  |
| a helper only the page needs | `steps/support/`                          | its doc comment      |
| a helper the API tests share | `apps/flash-be-e2e/steps/support/`        | import it from there |

The steps find elements by the words a shopper reads, so a change of a label in `flash-web`'s text tables changes the
locator here too.

## Commands

```bash
npx nx test:quick flash-web-e2e   # typecheck and lint
npx nx test:e2e flash-web-e2e     # builds both apps; needs the dev stack up (npx nx db:up flash-be)
```
