// Unit tests for the event reader: frames, keep-alives, the backoff between attempts, the give-up after the last one, and
// the refusals that stop it. The waits and the randomness are injected, so no test waits on the real clock.
import { describe, expect, it, vi } from "vitest";
import { createWatcher, parseFrames } from "./sse";

const encoder = new TextEncoder();

// A body that sends the given chunks and then ends.
function body(...chunks: string[]): ReadableStream<Uint8Array> {
	return new ReadableStream({
		start(controller) {
			for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
			controller.close();
		},
	});
}

// A body that sends the given chunks and then breaks, as a dropped connection does. It breaks only when the reader asks
// past the last chunk: an error set earlier would discard the chunks still queued.
function droppedBody(...chunks: string[]): ReadableStream<Uint8Array> {
	const pending = [...chunks];
	return new ReadableStream({
		pull(controller) {
			const next = pending.shift();
			if (next === undefined)
				controller.error(new TypeError("connection reset"));
			else controller.enqueue(encoder.encode(next));
		},
	});
}

// One frame, as flash-be sends it on connect.
const SALE_FRAME = 'event: sale\ndata: {"n":1}\n\n';

// Yields to the event loop once, without a real wait. A loop that reopens at once must still let timers run.
const tick = (): Promise<void> =>
	new Promise((resolve) => setTimeout(resolve, 0));

// The jitter that gives the top of each bound, and the one that gives none.
const topOfBound = () => 1;
const noJitter = () => 0;
const halfOfBound = () => 0.5;

// Records each wait, and yields like tick instead of waiting.
function recordWaits() {
	const waits: number[] = [];
	return {
		waits,
		sleep: async (ms: number): Promise<void> => {
			waits.push(ms);
			await tick();
		},
	};
}

// `count` answers that refuse the stream as busy.
const busy = (count: number): Response[] =>
	Array.from({ length: count }, () => new Response("busy", { status: 503 }));

describe("createWatcher", () => {
	it("passes events on, with the headers it was given", async () => {
		const events: Array<[string, unknown]> = [];
		const fetcher = vi.fn(async () => {
			// Split in the middle of a frame on purpose.
			return new Response(
				body('event: sale\ndata: {"remaining":', "4}\n\n: keep-alive\n\n"),
			);
		});
		const stop = createWatcher({ fetcher, sleep: tick, random: noJitter })(
			"/api/sales/x/events",
			(event, data) => {
				events.push([event, data]);
				return true;
			},
			{ headers: { "x-queue-ticket": "t" } },
		);
		// The stream ends at once and is opened again, so the same frame may come more than once; the first is enough.
		await vi.waitFor(() => expect(events.length).toBeGreaterThan(0));
		stop();
		expect(events[0]).toEqual(["sale", { remaining: 4 }]);
		const [, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
		expect(init.headers).toEqual({ "x-queue-ticket": "t" });
	});

	it.each([401, 404])(
		"stops for good on %i, and does not report a give-up",
		async (status) => {
			const fetcher = vi.fn(async () => new Response("no", { status }));
			const onGiveUp = vi.fn();
			createWatcher({ fetcher, sleep: tick, random: noJitter })(
				"/x",
				() => true,
				{ onGiveUp },
			);
			await vi.waitFor(() => expect(fetcher).toHaveBeenCalled());
			await tick();
			await tick();
			expect(fetcher).toHaveBeenCalledTimes(1);
			expect(onGiveUp).not.toHaveBeenCalled();
		},
	);

	it("opens the stream again after it ends, fails, or answers with an error", async () => {
		const answers = [
			() => new Response(body('event: sale\ndata: {"n":1}\n\n')),
			() => {
				throw new TypeError("fetch failed");
			},
			() => new Response("busy", { status: 503 }),
			() => new Response(body('event: sale\ndata: {"n":2}\n\n')),
		];
		let call = 0;
		const fetcher = vi.fn(async () => {
			const answer = answers[Math.min(call++, answers.length - 1)];
			if (!answer) throw new Error("no answer");
			return answer();
		});
		const seen: unknown[] = [];
		const stop = createWatcher({ fetcher, sleep: tick, random: noJitter })(
			"/x",
			(_event, data) => {
				seen.push(data);
				return true;
			},
		);
		await vi.waitFor(() =>
			expect(seen).toEqual(expect.arrayContaining([{ n: 2 }])),
		);
		stop();
		expect(seen[0]).toEqual({ n: 1 });
	});

	it("stops asking once it is stopped", async () => {
		const fetcher = vi.fn(async () => new Response(body()));
		const stop = createWatcher({ fetcher, sleep: tick, random: noJitter })(
			"/x",
			() => true,
		);
		await vi.waitFor(() => expect(fetcher).toHaveBeenCalled());
		stop();
		const calls = fetcher.mock.calls.length;
		await tick();
		await tick();
		expect(fetcher.mock.calls.length).toBeLessThanOrEqual(calls + 1);
	});

	it("waits a backoff delay between failed attempts, then reports the give-up once", async () => {
		const { waits, sleep } = recordWaits();
		const fetcher = vi.fn(async () => new Response("busy", { status: 503 }));
		const onGiveUp = vi.fn();
		createWatcher({
			fetcher,
			policy: { baseMs: 100, capMs: 300, maxAttempts: 4 },
			sleep,
			random: halfOfBound,
		})("/x", () => true, { onGiveUp });
		await vi.waitFor(() => expect(onGiveUp).toHaveBeenCalledOnce());
		expect(fetcher).toHaveBeenCalledTimes(4);
		// The bounds are 100, 200 and then the cap of 300; each wait is half of its bound.
		expect(waits).toEqual([50, 100, 150]);
	});

	it("counts a 200 with no body as a failed try, so it gives up", async () => {
		const { waits, sleep } = recordWaits();
		const fetcher = vi.fn(async () => new Response(null, { status: 200 }));
		const onGiveUp = vi.fn();
		createWatcher({ fetcher, sleep, random: topOfBound })("/x", () => true, {
			onGiveUp,
		});
		await vi.waitFor(() => expect(onGiveUp).toHaveBeenCalledOnce());
		expect(fetcher).toHaveBeenCalledTimes(8);
		expect(waits).toEqual([1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000]);
	});

	it("makes eight attempts by default, waiting from 1 s up to 30 s apart", async () => {
		const { waits, sleep } = recordWaits();
		const fetcher = vi.fn(async () => new Response("busy", { status: 503 }));
		const onGiveUp = vi.fn();
		createWatcher({ fetcher, sleep, random: topOfBound })("/x", () => true, {
			onGiveUp,
		});
		await vi.waitFor(() => expect(onGiveUp).toHaveBeenCalledOnce());
		expect(fetcher).toHaveBeenCalledTimes(8);
		expect(waits).toEqual([1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000]);
	});

	it.each<[string, () => ReadableStream<Uint8Array>]>([
		["closes", () => body()],
		["sends only a keep-alive, then closes", () => body(": keep-alive\n\n")],
		["drops", () => droppedBody()],
	])(
		"gives up when every stream opens with 200 and carries no frame (%s), and waits longer each time",
		async (_how, makeBody) => {
			const { waits, sleep } = recordWaits();
			const fetcher = vi.fn(async () => new Response(makeBody()));
			const onGiveUp = vi.fn();
			createWatcher({ fetcher, sleep, random: topOfBound })("/x", () => true, {
				onGiveUp,
			});
			await vi.waitFor(() => expect(onGiveUp).toHaveBeenCalledOnce());
			expect(fetcher).toHaveBeenCalledTimes(8);
			expect(waits).toEqual([
				1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000,
			]);
		},
	);

	it("starts the count again once a stream has delivered a frame", async () => {
		// Seven failures, a stream with a frame that ends, then eight more failures before the give-up.
		const plan = [...busy(7), new Response(body(SALE_FRAME)), ...busy(8)];
		const fetcher = vi.fn(
			async () => plan.shift() ?? new Response("late", { status: 503 }),
		);
		const onGiveUp = vi.fn();
		createWatcher({ fetcher, sleep: tick, random: noJitter })(
			"/x",
			() => true,
			{
				onGiveUp,
			},
		);
		await vi.waitFor(() => expect(onGiveUp).toHaveBeenCalledOnce());
		expect(fetcher).toHaveBeenCalledTimes(16);
	});

	it("reopens a stream that drops after it delivered a frame, and does not count that as a failure", async () => {
		const seen: unknown[] = [];
		const plan = [
			new Response(droppedBody(SALE_FRAME)),
			new Response("gone", { status: 404 }),
		];
		const fetcher = vi.fn(
			async () => plan.shift() ?? new Response("late", { status: 503 }),
		);
		const onGiveUp = vi.fn();
		createWatcher({ fetcher, sleep: tick, random: noJitter })(
			"/x",
			(_event, data) => {
				seen.push(data);
				return true;
			},
			{ onGiveUp },
		);
		await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
		await tick();
		await tick();
		expect(seen).toEqual([{ n: 1 }]);
		expect(onGiveUp).not.toHaveBeenCalled();
	});

	it("does not count a frame the listener refuses as a live stream, so a stream of refused frames gives up", async () => {
		const fetcher = vi.fn(async () => new Response(body(SALE_FRAME)));
		const onGiveUp = vi.fn();
		createWatcher({ fetcher, sleep: tick, random: noJitter })(
			"/x",
			() => false,
			{ onGiveUp },
		);
		await vi.waitFor(() => expect(onGiveUp).toHaveBeenCalledOnce());
		expect(fetcher).toHaveBeenCalledTimes(8);
	});

	it("gives up at once when it is stopped during a wait, and reports nothing", async () => {
		let stopWatching: () => void = () => {};
		const onGiveUp = vi.fn();
		const fetcher = vi.fn(async () => new Response("busy", { status: 503 }));
		stopWatching = createWatcher({
			fetcher,
			sleep: async () => {
				stopWatching();
			},
			random: noJitter,
		})("/x", () => true, { onGiveUp });
		await vi.waitFor(() => expect(fetcher).toHaveBeenCalled());
		await tick();
		await tick();
		expect(fetcher).toHaveBeenCalledTimes(1);
		expect(onGiveUp).not.toHaveBeenCalled();
	});

	it("uses the global fetch by default", async () => {
		const fetcher = vi.fn(async () => new Response("no", { status: 404 }));
		vi.stubGlobal("fetch", fetcher);
		try {
			createWatcher()("/x", () => true);
			await vi.waitFor(() => expect(fetcher).toHaveBeenCalled());
		} finally {
			vi.unstubAllGlobals();
		}
	});
});

describe("parseFrames", () => {
	it("splits whole frames, keeps the rest, and skips comments and broken data", () => {
		const { frames, rest } = parseFrames(
			': keep-alive\n\nevent: sale\ndata: {"n":1}\n\nevent: sale\ndata: nope\n\ndata: {"n":2}\n\nevent: place\ndata: {"n"',
		);
		expect(frames).toEqual([
			{ event: "sale", data: { n: 1 } },
			{ event: "message", data: { n: 2 } },
		]);
		expect(rest).toBe('event: place\ndata: {"n"');
	});

	it("skips a frame that has no data", () => {
		expect(parseFrames("event: sale\n\n").frames).toEqual([]);
	});
});
