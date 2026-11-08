// Unit tests for stream-closer.ts: a proxied event stream passes its chunks, ends cleanly when the server stops, and lets
// go of flash-be; any other body passes unchanged; every copy of the module shares one set of streams.
import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { createStreamCloser, endStreamsOnStop } from "./stream-closer";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

// A body like flash-be's event stream: it sends one event, then stays open until it is cancelled.
function openUpstream() {
	let cancelled = false;
	const body = new ReadableStream<Uint8Array>({
		start(controller) {
			controller.enqueue(encoder.encode("event: sale\n\n"));
		},
		cancel() {
			cancelled = true;
		},
	});
	return { body, cancelled: () => cancelled };
}

const eventStream = (body: ReadableStream<Uint8Array> | null) =>
	new Response(body, { headers: { "content-type": "text/event-stream" } });

describe("a proxied event stream", () => {
	it("passes the chunks of flash-be on", async () => {
		const closer = createStreamCloser();
		const upstream = openUpstream();
		const reader = closer.bodyOf(eventStream(upstream.body))?.getReader();
		const first = await reader?.read();
		expect(decoder.decode(first?.value)).toBe("event: sale\n\n");
	});

	it("ends cleanly when the server stops, and cancels the stream from flash-be", async () => {
		const closer = createStreamCloser();
		const upstream = openUpstream();
		const reader = closer.bodyOf(eventStream(upstream.body))?.getReader();
		await reader?.read();
		const pending = reader?.read();
		closer.endAll();
		expect((await pending)?.done).toBe(true);
		expect(upstream.cancelled()).toBe(true);
	});

	it("ends cleanly when the stop comes while a read from flash-be is still waiting", async () => {
		const closer = createStreamCloser();
		const upstream = openUpstream();
		const reader = closer.bodyOf(eventStream(upstream.body))?.getReader();
		await reader?.read();
		// One turn of the event loop, so the next read from flash-be has started and waits.
		await new Promise((resolve) => setTimeout(resolve, 0));
		const pending = reader?.read();
		closer.endAll();
		expect((await pending)?.done).toBe(true);
		expect(upstream.cancelled()).toBe(true);
		expect(closer.open()).toBe(0);
	});

	it("ends when flash-be ends it, and is forgotten", async () => {
		const closer = createStreamCloser();
		const body = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.close();
			},
		});
		const reader = closer.bodyOf(eventStream(body))?.getReader();
		expect((await reader?.read())?.done).toBe(true);
		expect(closer.open()).toBe(0);
	});

	it("fails when flash-be's stream fails, is forgotten, and a later stop still works", async () => {
		const closer = createStreamCloser();
		const lost = new TypeError("terminated");
		const body = new ReadableStream<Uint8Array>({
			pull(controller) {
				controller.error(lost);
			},
		});
		const reader = closer.bodyOf(eventStream(body))?.getReader();
		await expect(reader?.read()).rejects.toBe(lost);
		expect(closer.open()).toBe(0);
		expect(() => closer.endAll()).not.toThrow();
	});

	it("ends cleanly even when flash-be's stream failed just before the stop", async () => {
		const closer = createStreamCloser();
		let fail = (_cause: Error): void => {};
		const body = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(encoder.encode("event: sale\n\n"));
				fail = (cause) => controller.error(cause);
			},
		});
		const reader = closer.bodyOf(eventStream(body))?.getReader();
		await reader?.read();
		const pending = reader?.read();
		fail(new TypeError("terminated"));
		closer.endAll();
		expect((await pending)?.done).toBe(true);
		expect(closer.open()).toBe(0);
	});

	it("lets go of flash-be when the browser leaves", async () => {
		const closer = createStreamCloser();
		const upstream = openUpstream();
		const reader = closer.bodyOf(eventStream(upstream.body))?.getReader();
		await reader?.cancel();
		expect(upstream.cancelled()).toBe(true);
		expect(closer.open()).toBe(0);
	});
});

describe("any other body", () => {
	it("passes unchanged, so a JSON reply is never cut short", () => {
		const closer = createStreamCloser();
		const reply = Response.json({ ok: true });
		expect(closer.bodyOf(reply)).toBe(reply.body);
		expect(closer.open()).toBe(0);
	});

	it("passes a reply with no content type unchanged", () => {
		const closer = createStreamCloser();
		const reply = new Response(openUpstream().body);
		expect(closer.bodyOf(reply)).toBe(reply.body);
		expect(closer.open()).toBe(0);
	});

	it("passes an event stream with no body unchanged", () => {
		const closer = createStreamCloser();
		expect(closer.bodyOf(eventStream(null))).toBeNull();
	});
});

describe("endStreamsOnStop", () => {
	const PID = 4242;
	// A stand-in for the process: its signals, and a kill that only records.
	const processLike = () =>
		Object.assign(new EventEmitter(), { pid: PID, kill: vi.fn() });
	// The web server's own shutdown, which listens for the same signals.
	const serverShutdown = (signals: EventEmitter) => {
		signals.on("SIGTERM", () => undefined);
		signals.on("SIGINT", () => undefined);
	};

	it("ends the open streams on SIGTERM and on SIGINT, and listens once", async () => {
		const signals = processLike();
		const closer = createStreamCloser();
		endStreamsOnStop(closer, signals);
		endStreamsOnStop(closer, signals);
		serverShutdown(signals);
		expect(signals.listenerCount("SIGTERM")).toBe(2);
		expect(signals.listenerCount("SIGINT")).toBe(2);
		const first = closer.bodyOf(eventStream(openUpstream().body))?.getReader();
		const second = closer.bodyOf(eventStream(openUpstream().body))?.getReader();
		await first?.read();
		await second?.read();
		signals.emit("SIGTERM");
		expect((await first?.read())?.done).toBe(true);
		signals.emit("SIGINT");
		expect((await second?.read())?.done).toBe(true);
		expect(signals.kill).not.toHaveBeenCalled();
	});

	// Node stops on a signal only when nothing listens for it, and the server's own shutdown is off when CI or TEST is set.
	it.each(["SIGTERM", "SIGINT"] as const)(
		"steps aside on %s when nothing else handles the stop, so the process still stops",
		async (signal) => {
			const signals = processLike();
			const closer = createStreamCloser();
			endStreamsOnStop(closer, signals);
			const reader = closer
				.bodyOf(eventStream(openUpstream().body))
				?.getReader();
			await reader?.read();
			signals.emit(signal);
			expect((await reader?.read())?.done).toBe(true);
			expect(signals.listenerCount(signal)).toBe(0);
			expect(signals.kill).toHaveBeenCalledExactlyOnceWith(PID, signal);
		},
	);
});

describe("proxiedStreams", () => {
	// The built server has two copies of this module: one in the proxy's bundle and one in the Nitro plugin's.
	it("is the same set in every copy of the module, so the plugin ends the streams the proxy opened", async () => {
		vi.resetModules();
		const first = await import("./stream-closer");
		vi.resetModules();
		const second = await import("./stream-closer");
		expect(first).not.toBe(second);
		expect(second.proxiedStreams).toBe(first.proxiedStreams);
	});
});
