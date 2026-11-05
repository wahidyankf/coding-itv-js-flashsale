# Live updates

A page that asks "is it open yet?" every second makes every shopper send a request every second. The server can instead
hold one connection per page and say something only when it changes. The API does this with Server-Sent Events (SSE).

## Why SSE

SSE is one direction, from the server to the page, over plain HTTP. That is all this system needs: the sale status goes
down, and the shopper's actions go up as normal requests. The browser reconnects by itself, there is no protocol to
build, and it passes through proxies as a long response. A WebSocket would add a second protocol for a channel that
never has to carry anything upward.

## What a stream does

Two streams exist: the sale (`/sales/:saleId/events`) and a shopper's place (`/sales/:saleId/queue/:userId/events`).
Each reads its source every `EVENTS_INTERVAL_MS`, compares the result with what it last sent, and writes an event only
when it differs. A quiet sale produces no traffic except a keep-alive comment every 15 seconds, which stops proxies
from closing an idle connection.

The sale stream reads through the sale read cache. A thousand watchers therefore add no more database reads than one:
the cache holds the row for its time, and each stream just re-reads the cached value. The place stream costs one Redis
read per interval per watcher, which is the same cost as polling the plain route, but with no request overhead and no
traffic when the place did not move.

## Why polling inside, and not pub/sub

The server could publish a message when stock changes and let the streams subscribe. It does not, for two reasons.
The stock changes in Postgres from several processes, and a publish after commit can be lost, so a subscriber would
still need a periodic read as a safety net. And a read every second from a cache is cheap enough that the extra moving
part buys nothing at this size. If the interval had to drop to tens of milliseconds, pub/sub would be the next step.

## Errors and shutdown

The ticket and the sale are checked once, when the stream opens, so a mistake gets a normal JSON error. After that a
failed read is logged and skipped, and the next interval tries again. When the client leaves, the loop stops. When the
server closes, it drops open streams so it does not wait for them.

## What the browser sees

The browser never talks to this API. The web app reads the stream on its server and sends it on to the page. Because an
`EventSource` cannot set the ticket header, the web server adds it.
