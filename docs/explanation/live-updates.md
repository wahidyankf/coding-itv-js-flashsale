# Live updates

A page that asks "is it open yet?" every second makes every shopper send a request every second. The server can instead
hold one connection per page and say something only when it changes. The API does this with Server-Sent Events (SSE).

## Why SSE

SSE is one direction, from the server to the page, over plain HTTP. That is all this system needs: the sale status goes
down, and the shopper's actions go up as normal requests. The page reopens a stream that drops by itself, there is no protocol to
build, and it passes through proxies as a long response. A WebSocket would add a second protocol for a channel that
never has to carry anything upward.

## What a stream does

Two streams exist: the sale (`/api/v1/sales/:saleId/events`) and a shopper's place (`/api/v1/sales/:saleId/queue/me/events`, which needs the login cookie).
Each reads its source every `EVENTS_INTERVAL_MS`, compares the result with what it last sent, and writes an event only
when it differs. A quiet sale produces no traffic except a keep-alive comment every 15 seconds, which stops proxies
from closing an idle connection.

The sale stream reads through the sale read cache. A thousand watchers therefore add no more database reads than one:
the cache holds the row for its time, and each stream just re-reads the cached value. The place stream costs one Redis
read per interval per watcher, which is the same cost as polling the plain route, but with no request overhead and no
traffic when the place did not move.

## Why polling inside, and not pub/sub

A publish after commit can be lost, so a subscriber would still need a periodic read, and a read every second from the
cache is cheap at this size. [Decision 008](decisions/008-server-sent-events.md) weighs pub/sub, WebSockets and polling
from the page. If the interval had to drop to tens of milliseconds, pub/sub would be the next step.

## Errors and shutdown

The ticket and the sale are checked once, when the stream opens, so a mistake gets a normal JSON error. After that a
failed read is logged and skipped, and the next interval tries again. When the client leaves, the loop stops. When the
server stops, it ends every open stream cleanly after its drain window (see
[liveness and readiness](liveness-and-readiness.md#stopping)), so the browser reconnects to another instance.

## What the browser sees

The browser never talks to this API. It opens the streams on its own web server, which passes them on (see
[the web server in front of the API](web-server-proxy.md)). An `EventSource` cannot send the ticket header, so the page
reads the stream with `fetch` and sets `x-queue-ticket` itself. A stream that ends or cannot be
reached is opened again with backoff and jitter, for a limited number of tries
([the retry policies](../reference/retry-policies.md), [decision 017](decisions/017-retry-backoff-jitter.md)).
After the last try the page says "Live updates stopped. Reload the page to see the latest sale.", so a shopper does not
trust words that may be old. A `401` or `404` stops the reader at once, since asking again will not change the answer.
An event the page cannot decode is dropped and does not count as a live frame
([decision 018](decisions/018-decode-payloads-at-the-edge.md)).
