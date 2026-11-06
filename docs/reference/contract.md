# Contract library

`@flash/contract` (`libs/contract`) is the HTTP contract of `flash-be`. It depends on `zod` and `@flash/typekit`, and it
is built to `dist` (`npx nx build contract`). The Nx targets of the apps that use it build it first. For the reasons, see
[the API contract](../explanation/api-contract.md). The generated description of the routes is
[openapi.json](openapi.json).

It has two entry points.

## `@flash/contract/vocabulary`

No Zod. The domain of `flash-be` may import this entry.

| Export                                                                                                              | What it is                                                                    |
| ------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `USER_ID_PATTERN`, `normalizeUserId`                                                                                | the user id rule; `normalizeUserId` trims, lowercases and returns `undefined` when the id is not usable |
| `UUID_PATTERN`, `isUuid`                                                                                            | the id rule for sales and reservations                                        |
| `TICKET_HEADER`, `RETRY_AFTER_HEADER`                                                                               | header names                                                                  |
| `SALE_STATUSES`, `SaleStatus`, `PLACE_STATES`                                                                       | the states a sale and a place can have                                        |
| `ERROR_STATUS`, `ErrorCode`, `isErrorCode`                                                                          | every error code and the one HTTP status that answers it                      |
| `JOIN_ERRORS`, `CHECK_ERRORS`, `RESERVE_ERRORS`, `CONFIRM_ERRORS`, `OUTCOME_ERRORS`, `COMMON_ERRORS`, `FIELD_ERROR` | the codes each operation may answer with                                      |

## `@flash/contract`

Everything above, and:

| Export                                                                               | What it is                                                                                          |
| ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| `SaleView`, `PlaceView`, `JoinedView`, `ReservedView`, `PurchaseView`, `OutcomeView` | Zod schemas and types of the replies                                                                |
| `HealthView`, `ReadyView`, `RateLimitedBody`, `ErrorBody`, `QueuePlace`              | the rest of the schemas                                                                             |
| `routes`, `Route`, `Routes`, `Method`                                                | the route table: twelve routes, each with its params, headers, body and replies                     |
| `RequestInput<R>`, `Reply<R>`, `AnyReply<R>`, `ErrorCodeOf<R>`                       | types worked out from a route                                                                       |
| `buildRequest(route, input, baseUrl)`                                                | method, URL, headers and body text of a request                                                     |
| `pathOf`, `matchRoute(method, path)`                                                 | a path from a route, and the route a path belongs to                                                |
| `parseReply(route, { status, headers, text })`                                       | `Ok` with a reply the route declares, or `Err` with an `ApiFailure`                                 |
| `ApiFailure`                                                                         | `error` is an `ErrorCode`, `"network"` or `"unexpected"`; may hold `status` and `retryAfterSeconds` |
| `createClient({ baseUrl, fetch })`                                                   | `call(route, input)` over `fetch`, returning a `Result`                                             |
| `formatFrame`, `KEEP_ALIVE_FRAME`, `parseFrames`, `readStreamEvent`, `StreamEvent`   | the Server-Sent Events codec                                                                        |

A route has three flags: `passThrough` (the web server passes it on to the API), `stream` (the `200` reply is an event
stream) and `limited` (the rate limiter looks at it, so it can answer `429`).

## Targets

`build`, `typecheck`, `lint`, `test:unit`, `test:coverage` and `test:quick`. It needs no Docker.

## Related scripts

| Command                       | What it does                                                              |
| ----------------------------- | ------------------------------------------------------------------------- |
| `npm run openapi:generate`    | writes `docs/reference/openapi.json` from the routes `flash-be` registers |
| `npm run openapi:check`       | fails when that file is out of date; runs in the pre-push hook            |
| `npm run contract:guard:test` | fails when product code writes an API path or the ticket header by hand   |
