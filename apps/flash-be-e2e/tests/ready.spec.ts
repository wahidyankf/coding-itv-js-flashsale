import { expect, test } from "@playwright/test";

// Needs Postgres and Redis up. test:e2e starts them through Nx first.
test("GET /ready reports Postgres and Redis as ok", async ({ request }) => {
	const response = await request.get("/ready");

	expect(response.status()).toBe(200);
	expect(await response.json()).toEqual({
		status: "ok",
		checks: { database: "ok", redis: "ok" },
	});
});
