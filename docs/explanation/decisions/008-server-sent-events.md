# 008: Server-Sent Events for live updates

## Status

Accepted. The page follows the sale and its queue place over Server-Sent Events (SSE).

## Context

The brief wants a page that shows the sale status. In a flash sale thousands of pages are open, and shoppers wait for
"open now" and for the items left. A page that asks every second makes every shopper send a request every second.

## Decision

- Two streams: the sale (`/sales/:saleId/events`) and a shopper's queue place (`/sales/:saleId/queue/me/events`, which needs the login).
- Each stream reads its source every `EVENTS_INTERVAL_MS` (one second by default) and writes an event only when the result
  changed. A comment line every 15 seconds keeps proxies from closing an idle connection.
- The sale stream reads through the one-second sale cache, so many watchers cost about one database read a second.
- The page reads the stream with `fetch`, not `EventSource`, because it must send the ticket header.

## Alternatives considered

- **Polling from the page.** It is the simplest, but every shopper sends a request every second, and most answers say nothing new.
- **WebSockets.** They add a second protocol for a channel that carries nothing upward. Shopper actions are normal requests.
- **Publish a message when stock changes (Redis pub/sub).** The stock changes in Postgres from several processes, and a
  publish after commit can be lost, so a periodic read would still be needed. A read from a cache is cheap at this size.
- **Long polling.** It gives a similar effect, but each shopper still makes a new request after every change.

## Consequences

- It costs one open connection per watcher, and a read inside the server at each interval. The place stream costs one
  Redis read per interval per watcher. It has no request overhead and no traffic when the place does not move.
- It buys a page that follows the sale by itself, plain HTTP with no new protocol, and a stream that passes through the web server proxy as a long response.
- The page can be up to a second behind. A failed read is logged and skipped.

## Revisit when

- The interval has to drop to tens of milliseconds: use pub/sub, with the periodic read kept as a safety net.
- The page must send messages upward on the same channel: use WebSockets.
- The open connections of one instance become the limit: add instances, or move streams to their own process.

## Related

- [Live updates](../live-updates.md) and [the sale read cache](../sale-read-cache.md).
- Code: [`event-stream.ts`](../../../apps/flash-be/src/adapters/inbound/http/event-stream.ts) and [`sse.ts`](../../../apps/flash-web/src/sale/sse.ts).
