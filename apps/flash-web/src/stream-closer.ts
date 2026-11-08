// Server only. The event streams the proxy passes from flash-be to the browser, and their end when this server stops. The
// server's own shutdown waits for every open connection, and an event stream never ends by itself, so without this each
// one would hold the stop until its time limit and then be cut. Ended at once, the page's stream reader (sale/sse.ts)
// opens it again after its short wait, on an instance that is still running. proxy.ts sends each body through here; the
// Nitro plugin in server-plugins/ starts the listening.
import { attemptAsync } from "@flash/typekit";

// The proxied event streams that are open now.
export type StreamCloser = {
	// The body to send back for a reply of flash-be. An event stream is tracked, so it can be ended; any other body is
	// returned unchanged, so a JSON reply is never cut short.
	bodyOf: (upstream: Response) => ReadableStream<Uint8Array> | null;
	// Ends every open event stream cleanly, and lets go of flash-be's side of each.
	endAll: () => void;
	// How many event streams are open.
	open: () => number;
};

const EVENT_STREAM = "text/event-stream";

// A new, empty set of proxied streams.
export function createStreamCloser(): StreamCloser {
	// How to end each open stream, by the reader of flash-be's side. A stream that ended for any reason is not here.
	const ends = new Map<ReadableStreamDefaultReader<Uint8Array>, () => void>();

	// Copies `body` chunk by chunk into a stream this server can end at any moment.
	const track = (body: ReadableStream<Uint8Array>) => {
		const reader = body.getReader();
		return new ReadableStream<Uint8Array>({
			start(controller) {
				ends.set(reader, () => {
					ends.delete(reader);
					// flash-be's side may have just failed; that failure no longer matters to anyone.
					void attemptAsync(() => reader.cancel(), Error);
					controller.close();
				});
			},
			async pull(controller) {
				const read = await attemptAsync(() => reader.read(), Error);
				// Ended by a stop or by the browser while the read waited.
				if (!ends.has(reader)) return;
				// flash-be's stream broke: the browser's stream fails too, so the page opens it again.
				if (read.isErr()) {
					ends.delete(reader);
					controller.error(read.error);
					return;
				}
				if (read.value.done) {
					ends.delete(reader);
					controller.close();
					return;
				}
				controller.enqueue(read.value.value);
			},
			// The browser left: flash-be's side is let go too.
			async cancel(reason) {
				ends.delete(reader);
				await reader.cancel(reason);
			},
		});
	};

	return {
		bodyOf: (upstream) => {
			const type = upstream.headers.get("content-type") ?? "";
			if (upstream.body === null || !type.startsWith(EVENT_STREAM)) {
				return upstream.body;
			}
			return track(upstream.body);
		},
		endAll: () => {
			for (const end of [...ends.values()]) end();
		},
		open: () => ends.size,
	};
}

// The built server has two copies of this module, one in the proxy's bundle and one in the Nitro plugin's, so the one
// set of the process is kept on globalThis under a registered symbol, which both copies find.
const SHARED = Symbol.for("flash-web.proxied-streams");
const shared: typeof globalThis & { [SHARED]?: StreamCloser } = globalThis;

// The streams of this server process. proxy.ts tracks every proxied body here, and the Nitro plugin ends them.
shared[SHARED] ??= createStreamCloser();
export const proxiedStreams: StreamCloser = shared[SHARED];

// The signals that ask this server to stop.
const STOP_SIGNALS = ["SIGTERM", "SIGINT"] as const;
type StopSignal = (typeof STOP_SIGNALS)[number];

// Where the stop signals arrive, and how one is sent again: the process, or a stand-in in a test.
type Signals = {
	on: (signal: StopSignal, run: () => void) => unknown;
	off: (signal: StopSignal, run: () => void) => unknown;
	listenerCount: (signal: StopSignal) => number;
	kill: (pid: number, signal: StopSignal) => unknown;
	pid: number;
};

// The closers that already listen, so a second call adds no second listener.
const listening = new WeakSet<StreamCloser>();

// Ends the open streams of `closer` when the process is asked to stop, at the start of the server's own shutdown. It never
// keeps the process alive: Node stops on a signal only when nothing listens for it, so when the server's own shutdown is
// off (srvx skips it when CI or TEST is set), this listener steps aside and sends the signal again.
export function endStreamsOnStop(
	closer: StreamCloser,
	signals: Signals = process,
): void {
	if (listening.has(closer)) return;
	listening.add(closer);
	for (const signal of STOP_SIGNALS) {
		const onStop = () => {
			closer.endAll();
			if (signals.listenerCount(signal) > 1) return;
			signals.off(signal, onStop);
			signals.kill(signals.pid, signal);
		};
		signals.on(signal, onStop);
	}
}
