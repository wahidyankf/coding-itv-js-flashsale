// Unit tests for the HTTP app while it stops, over fake dependencies on a real socket: readiness once it is stopping, the
// `connection: close` header, the event streams that a close ends, and a request in flight that a close waits for.
import { afterEach, describe, expect, it } from "vitest";
import type { SaleWithStatus } from "../../../application/sale-service.js";
import { healthyDeps } from "../../../bdd/support/deps.js";
import { fakeSale } from "../../../bdd/support/fake-sales.js";
import { buildApp } from "./app.js";

const apps: Array<ReturnType<typeof buildApp>> = [];
afterEach(async () => {
	await Promise.all(apps.splice(0).map((app) => app.close()));
});

const fast = { intervalMs: 10, heartbeatMs: 60_000 };
const view: SaleWithStatus = {
	sale: fakeSale({ stock: 10, sold: 3 }),
	status: "active",
};

// A promise and the function that settles it, so a test decides when a slow call ends.
function deferred() {
	let resolve: () => void = () => {};
	const promise = new Promise<void>((settle) => {
		resolve = settle;
	});
	return { promise, resolve };
}

describe("readiness while the app stops", () => {
	it("answers 503 with the status `stopping` and the checks of each store", async () => {
		const app = buildApp(healthyDeps, {
			cookieSecure: false,
			isStopping: () => true,
		});
		apps.push(app);
		const reply = await app.inject({ method: "GET", url: "/ready" });
		expect(reply.statusCode).toBe(503);
		expect(reply.json()).toEqual({
			status: "stopping",
			checks: { database: "ok", redis: "ok" },
		});
	});

	it("answers as before while the app is not stopping", async () => {
		const app = buildApp(healthyDeps, { cookieSecure: false });
		apps.push(app);
		const reply = await app.inject({ method: "GET", url: "/ready" });
		expect(reply.statusCode).toBe(200);
		expect(reply.headers.connection).not.toBe("close");
	});
});

describe("replies while the app stops", () => {
	it("tell the client to close the connection, so its next request goes to another instance", async () => {
		let stopping = false;
		const app = buildApp(healthyDeps, {
			cookieSecure: false,
			isStopping: () => stopping,
		});
		apps.push(app);
		const before = await app.inject({ method: "GET", url: "/health" });
		stopping = true;
		const after = await app.inject({ method: "GET", url: "/health" });
		expect(before.headers.connection).not.toBe("close");
		expect(after.headers.connection).toBe("close");
	});
});

describe("closing the app", () => {
	it("ends an open event stream, so its client reconnects elsewhere", async () => {
		const app = buildApp(
			{
				...healthyDeps,
				sales: { ...healthyDeps.sales, byId: async () => view },
			},
			{ cookieSecure: false, events: fast },
		);
		const origin = await app.listen({ host: "127.0.0.1", port: 0 });
		const reply = await fetch(`${origin}/api/v1/sales/s/events`);
		const reader = reply.body?.getReader();
		if (!reader) throw new Error("no body");
		const first = await reader.read();
		expect(new TextDecoder().decode(first.value)).toContain("event: sale");
		await app.close();
		let done = false;
		while (!done) done = (await reader.read()).done;
		expect(done).toBe(true);
	});

	it("waits for a request in flight and sends its answer", async () => {
		const payment = deferred();
		const started = deferred();
		const app = buildApp(
			{
				...healthyDeps,
				sales: {
					...healthyDeps.sales,
					byId: async () => {
						started.resolve();
						await payment.promise;
						return view;
					},
				},
			},
			{ cookieSecure: false, isStopping: () => true },
		);
		const origin = await app.listen({ host: "127.0.0.1", port: 0 });
		const pending = fetch(`${origin}/api/v1/sales/s`);
		await started.promise;
		let closed = false;
		const closing = app.close().then(() => {
			closed = true;
		});
		await new Promise((resolve) => setTimeout(resolve, 50));
		expect(closed).toBe(false);
		payment.resolve();
		const reply = await pending;
		expect(reply.status).toBe(200);
		expect(reply.headers.get("connection")).toBe("close");
		await closing;
		expect(closed).toBe(true);
	});

	it("stops a stream whose read was running when the app closed, without writing to it again", async () => {
		const read = deferred();
		let reads = 0;
		const app = buildApp(
			{
				...healthyDeps,
				sales: {
					...healthyDeps.sales,
					byId: async () => {
						reads++;
						// Read 1 is the check before the stream opens, read 2 the first event; read 3 waits.
						if (reads === 3) await read.promise;
						return reads === 3 ? { ...view, status: "sold_out" } : view;
					},
				},
			},
			{ cookieSecure: false, events: fast },
		);
		const origin = await app.listen({ host: "127.0.0.1", port: 0 });
		const reply = await fetch(`${origin}/api/v1/sales/s/events`);
		const reader = reply.body?.getReader();
		if (!reader) throw new Error("no body");
		await reader.read();
		while (reads < 3) await new Promise((resolve) => setTimeout(resolve, 5));
		await app.close();
		read.resolve();
		let seen = "";
		for (;;) {
			const chunk = await reader.read();
			if (chunk.done) break;
			seen += new TextDecoder().decode(chunk.value);
		}
		expect(seen).not.toContain("sold_out");
		expect(reads).toBe(3);
	});
});
