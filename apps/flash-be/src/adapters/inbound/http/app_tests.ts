import { Err, Ok } from "@flash/typekit";
import { afterEach, describe, expect, it } from "vitest";
import type { Dependencies } from "../../../application/dependencies.js";
import { healthyDeps } from "../../../bdd/support/deps.js";
import { buildApp } from "./app.js";
import { errorPayload } from "./errors.js";

const apps: Array<ReturnType<typeof buildApp>> = [];
afterEach(async () => {
	await Promise.all(apps.splice(0).map((app) => app.close()));
});

function appWith(deps: Dependencies = healthyDeps) {
	const app = buildApp(deps);
	apps.push(app);
	return app;
}

const json = { "content-type": "application/json" };
const MISSING_SALE = "00000000-0000-4000-8000-000000000000";
const QUEUE = "/sales/00000000-0000-4000-8000-000000000000/queue";

describe("the errors of the HTTP edge", () => {
	it("answers a failure inside the server with `internal` and no detail", async () => {
		const app = appWith({
			...healthyDeps,
			sales: {
				...healthyDeps.sales,
				current: async () => {
					throw new Error("secret detail");
				},
			},
		});
		const reply = await app.inject({ method: "GET", url: "/sales/current" });
		expect(reply.statusCode).toBe(500);
		expect(reply.json()).toEqual(errorPayload("internal"));
	});

	it("refuses a body that is too large as `invalid_request`", async () => {
		const reply = await appWith().inject({
			method: "POST",
			url: QUEUE,
			headers: json,
			payload: JSON.stringify({ userId: "a".repeat(2_000_000) }),
		});
		expect(reply.statusCode).toBe(400);
		expect(reply.json()).toEqual(errorPayload("invalid_request"));
	});

	it("refuses an unsupported media type as `invalid_request`", async () => {
		const reply = await appWith().inject({
			method: "POST",
			url: QUEUE,
			headers: { "content-type": "application/xml" },
			payload: "ana",
		});
		expect(reply.statusCode).toBe(400);
		expect(reply.json()).toEqual(errorPayload("invalid_request"));
	});

	it("refuses an empty JSON body as `invalid_request`", async () => {
		const reply = await appWith().inject({
			method: "POST",
			url: QUEUE,
			headers: json,
			payload: "",
		});
		expect(reply.statusCode).toBe(400);
		expect(reply.json()).toEqual(errorPayload("invalid_request"));
	});

	it("refuses a body that is null as `invalid_user`, like a missing name", async () => {
		const reply = await appWith().inject({
			method: "POST",
			url: QUEUE,
			headers: json,
			payload: "null",
		});
		expect(reply.statusCode).toBe(400);
		expect(reply.json()).toEqual(errorPayload("invalid_user"));
	});

	it("does not ask the service when the body is refused", async () => {
		let asked = 0;
		const app = appWith({
			...healthyDeps,
			queue: {
				...healthyDeps.queue,
				join: async (...args) => {
					asked += 1;
					return healthyDeps.queue.join(...args);
				},
			},
		});
		await app.inject({
			method: "POST",
			url: QUEUE,
			headers: json,
			payload: "{}",
		});
		expect(asked).toBe(0);
	});

	it("counts a refused body against the rate limit", async () => {
		const seen: unknown[] = [];
		const app = appWith({
			...healthyDeps,
			rateLimiter: {
				check: async (request) => {
					seen.push(request.user);
					return { limited: false };
				},
			},
		});
		await app.inject({
			method: "POST",
			url: QUEUE,
			headers: json,
			payload: '{"userId":5}',
		});
		expect(seen).toEqual([5]);
	});

	it("tells a client over the limit to wait, before it reads the body", async () => {
		const app = appWith({
			...healthyDeps,
			rateLimiter: {
				check: async () => ({ limited: true, retryAfterSeconds: 7 }),
			},
		});
		const reply = await app.inject({
			method: "POST",
			url: QUEUE,
			headers: json,
			payload: "{}",
		});
		expect(reply.statusCode).toBe(429);
		expect(reply.headers["retry-after"]).toBe("7");
		expect(reply.json()).toEqual({
			...errorPayload("rate_limited"),
			retryAfterSeconds: 7,
		});
	});
});

describe("the admin route at the edge", () => {
	const TOKEN = "operator-secret-0001";
	const admin = (authorize: Dependencies["admin"]["authorize"]) => ({
		...healthyDeps.admin,
		authorize,
	});
	const open = admin(() => new Ok(true as const));

	it("refuses a body of the wrong shape as `invalid_sale`, not as a bad user", async () => {
		const app = appWith({ ...healthyDeps, admin: open });
		const reply = await app.inject({
			method: "POST",
			url: "/admin/sales",
			headers: { ...json, authorization: `Bearer ${TOKEN}` },
			payload: JSON.stringify({ stock: "many" }),
		});
		expect(reply.statusCode).toBe(400);
		expect(reply.json()).toEqual(errorPayload("invalid_sale"));
	});

	it("refuses a change with a field of the wrong type as `invalid_sale`", async () => {
		const app = appWith({ ...healthyDeps, admin: open });
		const reply = await app.inject({
			method: "PATCH",
			url: `/admin/sales/${MISSING_SALE}`,
			headers: { ...json, authorization: `Bearer ${TOKEN}` },
			payload: JSON.stringify({ stock: "many" }),
		});
		expect(reply.statusCode).toBe(400);
		expect(reply.json()).toEqual(errorPayload("invalid_sale"));
	});

	it("refuses a body that is not JSON as `invalid_request`", async () => {
		const app = appWith({ ...healthyDeps, admin: open });
		const reply = await app.inject({
			method: "POST",
			url: "/admin/sales",
			headers: { ...json, authorization: `Bearer ${TOKEN}` },
			payload: "{oops",
		});
		expect(reply.statusCode).toBe(400);
		expect(reply.json()).toEqual(errorPayload("invalid_request"));
	});

	it("checks the token before it reads the body", async () => {
		const app = appWith({
			...healthyDeps,
			admin: admin(() => new Err("invalid_admin_token")),
		});
		const reply = await app.inject({
			method: "POST",
			url: "/admin/sales",
			headers: json,
			payload: "{oops",
		});
		expect(reply.statusCode).toBe(401);
		expect(reply.json()).toEqual(errorPayload("invalid_admin_token"));
	});

	it("counts every try by address and tells a client over the limit to wait", async () => {
		const seen: unknown[] = [];
		const app = appWith({
			...healthyDeps,
			admin: open,
			rateLimiter: {
				check: async (request) => {
					seen.push(request);
					return { limited: true, retryAfterSeconds: 3 };
				},
			},
		});
		const reply = await app.inject({
			method: "POST",
			url: "/admin/sales",
			headers: json,
			payload: "{}",
		});
		expect(reply.statusCode).toBe(429);
		expect(reply.headers["retry-after"]).toBe("3");
		expect(seen).toHaveLength(1);
		expect(seen[0]).toMatchObject({ saleId: "admin", user: undefined });
	});
});
