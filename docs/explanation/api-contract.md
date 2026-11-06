# The API contract

The HTTP API of `flash-be` is written down once, in code, in the library `libs/contract` (`@flash/contract`). The server,
the web client, the web proxy, the fake backend in the tests, the end-to-end tests, the load script and the OpenAPI file
all read it. None of them keeps its own copy of a path, a body shape or an error code.

## Why one contract

Before the contract, the same facts lived in about ten places: the routes in `flash-be`, the list in the web proxy, the
types in the web client, the paths in the e2e steps and the k6 script, the error codes in three tables and in the page
text. They drifted. The proxy accepted user ids that the domain refused, and the fake backend answered with a lossy
purchase body. A copy that is wrong is found late, by a user.

With one contract, a change has one place to start. If an endpoint changes and a consumer does not, that consumer stops
compiling, or its test fails because the reply no longer matches.

## What is in it

- **The route table** (`routes`). Each route has a name, a method, a path, the schema of its params, headers and body,
  and one schema per HTTP status it answers with. Errors are part of the table: every refusal is `{ "errorCode": "<code>", "errorMessage": "<sentence>" }`,
  and each code has exactly one status and one sentence. The status is not repeated in the body.
- **The vocabulary.** The rules that need no schema library: the user id pattern and its normalisation, the id pattern,
  the header names and the error codes. The domain of `flash-be` imports this part, so it stays free of Zod.
- **Two pure functions**, `buildRequest` and `parseReply`. They know nothing about the transport, so `fetch`,
  Playwright's request context and k6's `http` all use them.
- **A small client** (`createClient`) over `fetch`. It returns a `Result`: an `Ok` with a reply the route declares, or an
  `Err` that names the failure. See [failures as values](failures-as-values.md).
- **A Server-Sent Events codec** that the server writes with and the browser and the tests read with.

[The reference](../reference/contract.md) lists every export.

## How each part uses it

| Part         | What it takes from the contract                                                                       |
| ------------ | ----------------------------------------------------------------------------------------------------- |
| `flash-be`   | Registers every route from the table. Fastify checks the request and the reply against the schemas.   |
| OpenAPI      | Is generated from the routes the server registered, and checked in the pre-push hook.                 |
| `flash-web`  | Calls the API through the client. The proxy allows the routes marked for pass-through, and no others. |
| fake backend | Answers by contract path, and checks each reply against the route before it sends it.                 |
| e2e tests    | Build each request with `buildRequest` and read each reply with `parseReply`.                         |
| `flash-load` | The same two functions inside k6, bundled with esbuild, because k6 cannot read `node_modules`.        |

## What it costs

- The server checks every reply against its schema. On the hot path of the smoke run this stayed far below the limits
  (reserve p95 a few milliseconds against 300), so the check stays on in every environment.
- The browser bundle carries Zod.
- The route table and the client are code we maintain. They are small, and they sit behind two pure functions so that a
  community client could replace them later without touching the schemas.

## What it does not do

The contract says the shape of a request and a reply. It does not say when a rule applies. That is behaviour, and
behaviour lives in the Gherkin scenarios in [specs/](../../specs/README.md). The format rules (a user id is trimmed and
lowercased, then must match a pattern) are in the vocabulary, but the server still decides what a bad name means.

To change an endpoint, see [change an endpoint](../how-to/change-an-endpoint.md).
