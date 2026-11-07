import { Err, Ok } from "@flash/typekit";
import type { FastifyReply, FastifyRequest } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import type { Dependencies } from "../../../application/dependencies.js";
import { healthyDeps } from "../../../bdd/support/deps.js";
import { fakeSale } from "../../../bdd/support/fake-sales.js";
import { buildApp } from "./app.js";
import { formatEvent, serveEvents } from "./event-stream.js";

// Edges of the stream that the scenarios do not reach: a keep-alive, a sale that vanishes, a place that was lost.
const fast = { intervalMs: 10, heartbeatMs: 0 };
const apps: Array<{ close: () => Promise<void> }> = [];

// A shopper who is logged in: the place stream is for a login.
const SHOPPER_COOKIE = "access_token=shopper-token";
const auth: Dependencies["auth"] = {
	...healthyDeps.auth,
	authenticate: async (token) =>
		token === "shopper-token"
			? new Ok({ userId: "user-1", username: "ana", role: "shopper" as const })
			: new Err("not_authenticated" as const),
};

afterEach(async () => {
	await Promise.all(apps.splice(0).map((app) => app.close()));
});

async function readUntil(
	url: string,
	headers: Record<string, string>,
	text: string,
) {
	const controller = new AbortController();
	const reply = await fetch(url, { headers, signal: controller.signal });
	const reader = reply.body?.getReader();
	if (!reader) throw new Error("no body");
	const decoder = new TextDecoder();
	let seen = "";
	const deadline = Date.now() + 3000;
	while (!seen.includes(text) && Date.now() < deadline) {
		const chunk = await reader.read();
		if (chunk.done) break;
		seen += decoder.decode(chunk.value, { stream: true });
	}
	controller.abort();
	return seen;
}

// A reply and a request with only the parts `serveEvents` touches. Each write and the close listener are recorded.
function streamDouble() {
	const written: string[] = [];
	let onClose: () => void = () => {};
	const reply = {
		hijack: () => {},
		raw: { writeHead: () => {}, write: (text: string) => written.push(text) },
	} as unknown as FastifyReply;
	const request = {
		raw: {
			on: (_event: string, listener: () => void) => {
				onClose = listener;
			},
		},
	} as unknown as FastifyRequest;
	return { written, reply, request, close: () => onClose() };
}

describe("serveEvents", () => {
	it("sends nothing, not even a keep-alive, and logs nothing when the read has nothing to tell", async () => {
		const stream = streamDouble();
		const logged: unknown[] = [];
		serveEvents(
			stream.request,
			stream.reply,
			async () => undefined,
			{ intervalMs: 1000, heartbeatMs: 0 },
			(error) => logged.push(error),
		);
		await new Promise((resolve) => setTimeout(resolve, 5));
		stream.close();
		expect(stream.written).toEqual([]);
		expect(logged).toEqual([]);
	});
});

describe("the event stream", () => {
	it("formats an event as the SSE wire text", () => {
		expect(formatEvent({ event: "sale", data: { remaining: 3 } })).toBe(
			'event: sale\ndata: {"remaining":3}\n\n',
		);
	});

	it("sends a keep-alive comment when nothing changed", async () => {
		const sale = fakeSale({});
		const view = {
			...sale,
			status: "active",
			remaining: 10,
		} as never;
		const app = buildApp(
			{
				...healthyDeps,
				sales: { ...healthyDeps.sales, byId: async () => view },
			},
			{ events: fast },
		);
		apps.push(app);
		const origin = await app.listen({ host: "127.0.0.1", port: 0 });
		const seen = await readUntil(
			`${origin}/sales/${sale.id}/events`,
			{},
			": keep-alive",
		);
		expect(seen).toContain("event: sale");
		expect(seen).toContain(": keep-alive");
	});

	it("keeps the stream open when a read fails, and goes on afterwards", async () => {
		let calls = 0;
		const view = { id: "s", status: "active", remaining: 4 } as never;
		const app = buildApp(
			{
				...healthyDeps,
				sales: {
					...healthyDeps.sales,
					byId: async () => {
						calls++;
						// The first call is the check before the stream opens, the second is the first read.
						if (calls === 2) return undefined;
						return view;
					},
				},
			},
			{ events: fast },
		);
		apps.push(app);
		const origin = await app.listen({ host: "127.0.0.1", port: 0 });
		const seen = await readUntil(
			`${origin}/sales/s/events`,
			{},
			'"remaining":4',
		);
		expect(seen).toContain('"remaining":4');
		expect(calls).toBeGreaterThan(2);
	});

	it("sends nothing for a read of a sale that is gone, and keeps reading until it is back", async () => {
		let calls = 0;
		const view = { id: "s", status: "active", remaining: 4 } as never;
		const back = { id: "s", status: "active", remaining: 5 } as never;
		const app = buildApp(
			{
				...healthyDeps,
				sales: {
					...healthyDeps.sales,
					byId: async () => {
						calls++;
						// Call 1 is the check before the stream opens. Call 2 is a read of a sale that is gone; then it is back.
						if (calls === 1) return view;
						if (calls === 2) return undefined;
						return back;
					},
				},
			},
			{ events: fast },
		);
		apps.push(app);
		const origin = await app.listen({ host: "127.0.0.1", port: 0 });
		const seen = await readUntil(
			`${origin}/sales/s/events`,
			{},
			'"remaining":5',
		);
		expect(seen.match(/event: sale/g)).toHaveLength(1);
		expect(seen).not.toContain("undefined");
		expect(calls).toBeGreaterThan(2);
	});

	it("tells a watcher whose place was lost that it is absent", async () => {
		let calls = 0;
		const app = buildApp(
			{
				...healthyDeps,
				auth,
				queue: {
					...healthyDeps.queue,
					check: async () => {
						calls++;
						return calls <= 2
							? new Ok({
									user: "ana",
									place: { state: "waiting" as const, place: 1 },
								})
							: new Err("not_in_queue");
					},
				},
			},
			{ events: fast },
		);
		apps.push(app);
		const origin = await app.listen({ host: "127.0.0.1", port: 0 });
		const seen = await readUntil(
			`${origin}/sales/s/queue/me/events`,
			{ "x-queue-ticket": "t", cookie: SHOPPER_COOKIE },
			'"state":"absent"',
		);
		expect(seen).toContain('"state":"waiting"');
		expect(seen).toContain('"state":"absent"');
	});

	it("refuses a place stream without a ticket", async () => {
		const app = buildApp(
			{
				...healthyDeps,
				auth,
				queue: {
					...healthyDeps.queue,
					check: async () => new Err("invalid_ticket"),
				},
			},
			{ events: fast },
		);
		apps.push(app);
		const origin = await app.listen({ host: "127.0.0.1", port: 0 });
		const reply = await fetch(`${origin}/sales/s/queue/me/events`, {
			headers: { cookie: SHOPPER_COOKIE },
		});
		expect(reply.status).toBe(401);
	});

	it("keeps a place stream open when a read fails", async () => {
		let calls = 0;
		const app = buildApp(
			{
				...healthyDeps,
				auth,
				queue: {
					...healthyDeps.queue,
					check: async () => {
						calls++;
						if (calls === 2) throw new Error("redis is down");
						return new Ok({
							user: "ana",
							place: { state: "admitted" as const },
						});
					},
				},
			},
			{ events: fast },
		);
		apps.push(app);
		const origin = await app.listen({ host: "127.0.0.1", port: 0 });
		const seen = await readUntil(
			`${origin}/sales/s/queue/me/events`,
			{ "x-queue-ticket": "t", cookie: SHOPPER_COOKIE },
			'"state":"admitted"',
		);
		expect(seen).toContain('"state":"admitted"');
		expect(calls).toBeGreaterThan(1);
	});

	it("stops reading once the client left in the middle of a read", async () => {
		let calls = 0;
		const view = { id: "s", status: "active", remaining: 4 } as never;
		const app = buildApp(
			{
				...healthyDeps,
				sales: {
					...healthyDeps.sales,
					byId: async () => {
						calls++;
						await new Promise((resolve) => setTimeout(resolve, 80));
						return view;
					},
				},
			},
			{ events: { intervalMs: 5, heartbeatMs: 15_000 } },
		);
		apps.push(app);
		const origin = await app.listen({ host: "127.0.0.1", port: 0 });
		const controller = new AbortController();
		const reply = await fetch(`${origin}/sales/s/events`, {
			signal: controller.signal,
		});
		const reader = reply.body?.getReader();
		await reader?.read();
		// The next read is running now. Leave while it runs.
		await new Promise((resolve) => setTimeout(resolve, 40));
		controller.abort();
		await new Promise((resolve) => setTimeout(resolve, 300));
		const after = calls;
		await new Promise((resolve) => setTimeout(resolve, 150));
		expect(calls).toBe(after);
	});
});
