import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { healthyDeps } from "../bdd/support/deps.js";
import { fakeSale } from "../bdd/support/fake-sales.js";
import { formatEvent } from "./event-stream.js";

// Edges of the stream that the scenarios do not reach: a keep-alive, a sale that vanishes, a place that was lost.
const fast = { intervalMs: 10, heartbeatMs: 0 };
const apps: Array<{ close: () => Promise<void> }> = [];

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

describe("the event stream", () => {
	it("formats an event as the SSE wire text", () => {
		expect(formatEvent({ event: "sale", data: { remaining: 3 } })).toBe(
			'event: sale\ndata: {"remaining":3}\n\n',
		);
	});

	it("sends a keep-alive comment when nothing changed", async () => {
		const sale = fakeSale({});
		const view = { ...sale, status: "active", remaining: 10 } as never;
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

	it("tells a watcher whose place was lost that it is absent", async () => {
		let calls = 0;
		const app = buildApp(
			{
				...healthyDeps,
				queue: {
					...healthyDeps.queue,
					check: async () => {
						calls++;
						return calls <= 2
							? { ok: true, user: "ana", place: { state: "waiting", place: 1 } }
							: { ok: false, error: "not_in_queue" };
					},
				},
			},
			{ events: fast },
		);
		apps.push(app);
		const origin = await app.listen({ host: "127.0.0.1", port: 0 });
		const seen = await readUntil(
			`${origin}/sales/s/queue/ana/events`,
			{ "x-queue-ticket": "t" },
			'"state":"absent"',
		);
		expect(seen).toContain('"state":"waiting"');
		expect(seen).toContain('"state":"absent"');
	});

	it("refuses a place stream without a ticket", async () => {
		const app = buildApp(
			{
				...healthyDeps,
				queue: {
					...healthyDeps.queue,
					check: async () => ({ ok: false, error: "invalid_ticket" }),
				},
			},
			{ events: fast },
		);
		apps.push(app);
		const origin = await app.listen({ host: "127.0.0.1", port: 0 });
		const reply = await fetch(`${origin}/sales/s/queue/ana/events`);
		expect(reply.status).toBe(401);
	});

	it("keeps a place stream open when a read fails", async () => {
		let calls = 0;
		const app = buildApp(
			{
				...healthyDeps,
				queue: {
					...healthyDeps.queue,
					check: async () => {
						calls++;
						if (calls === 2) throw new Error("redis is down");
						return { ok: true, user: "ana", place: { state: "admitted" } };
					},
				},
			},
			{ events: fast },
		);
		apps.push(app);
		const origin = await app.listen({ host: "127.0.0.1", port: 0 });
		const seen = await readUntil(
			`${origin}/sales/s/queue/ana/events`,
			{ "x-queue-ticket": "t" },
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
