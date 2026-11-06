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

describe("createWatcher", () => {
	it("passes events on, with the headers it was given", async () => {
		const events: Array<[string, unknown]> = [];
		const fetcher = vi.fn(async () => {
			// Split in the middle of a frame on purpose.
			return new Response(
				body('event: sale\ndata: {"remaining":', "4}\n\n: keep-alive\n\n"),
			);
		});
		const stop = createWatcher({ fetcher, retryMs: 5_000 })(
			"/api/sales/x/events",
			(event, data) => events.push([event, data]),
			{ "x-queue-ticket": "t" },
		);
		await vi.waitFor(() => expect(events).toHaveLength(1));
		stop();
		expect(events[0]).toEqual(["sale", { remaining: 4 }]);
		const [, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
		expect(init.headers).toEqual({ "x-queue-ticket": "t" });
	});

	it.each([401, 404])("stops for good on %i", async (status) => {
		const fetcher = vi.fn(async () => new Response("no", { status }));
		createWatcher({ fetcher, retryMs: 1 })("/x", () => {});
		await vi.waitFor(() => expect(fetcher).toHaveBeenCalled());
		await new Promise((resolve) => setTimeout(resolve, 30));
		expect(fetcher).toHaveBeenCalledTimes(1);
	});

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
		const stop = createWatcher({ fetcher, retryMs: 5 })("/x", (_event, data) =>
			seen.push(data),
		);
		await vi.waitFor(() =>
			expect(seen).toEqual(expect.arrayContaining([{ n: 2 }])),
		);
		stop();
		expect(seen[0]).toEqual({ n: 1 });
	});

	it("stops asking once it is stopped", async () => {
		const fetcher = vi.fn(async () => new Response(body()));
		const stop = createWatcher({ fetcher, retryMs: 5 })("/x", () => {});
		await vi.waitFor(() => expect(fetcher).toHaveBeenCalled());
		stop();
		const calls = fetcher.mock.calls.length;
		await new Promise((resolve) => setTimeout(resolve, 40));
		expect(fetcher.mock.calls.length).toBeLessThanOrEqual(calls + 1);
	});

	it("uses the global fetch and a one second pause by default", async () => {
		const fetcher = vi.fn(async () => new Response("no", { status: 404 }));
		vi.stubGlobal("fetch", fetcher);
		try {
			createWatcher()("/x", () => {});
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
