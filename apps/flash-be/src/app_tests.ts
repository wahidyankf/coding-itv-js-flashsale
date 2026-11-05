import { afterEach, describe, expect, it } from "vitest";
import { buildApp, type Dependencies } from "./app.js";

const healthy: Dependencies = {
	checkDatabase: async () => {},
	checkRedis: async () => {},
};

const apps: Array<{ close: () => Promise<unknown> }> = [];

function appWith(deps: Dependencies) {
	const app = buildApp(deps);
	apps.push(app);
	return app;
}

afterEach(async () => {
	await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe("GET /health", () => {
	it("returns ok without checking dependencies", async () => {
		const app = appWith({
			checkDatabase: async () => {
				throw new Error("should not be called");
			},
			checkRedis: async () => {
				throw new Error("should not be called");
			},
		});

		const response = await app.inject({ method: "GET", url: "/health" });

		expect(response.statusCode).toBe(200);
		expect(response.json()).toEqual({ status: "ok" });
	});
});

describe("GET /ready", () => {
	it("returns 200 when both dependencies are ok", async () => {
		const app = appWith(healthy);

		const response = await app.inject({ method: "GET", url: "/ready" });

		expect(response.statusCode).toBe(200);
		expect(response.json()).toEqual({
			status: "ok",
			checks: { database: "ok", redis: "ok" },
		});
	});

	it("returns 503 when the database check fails", async () => {
		const app = appWith({
			...healthy,
			checkDatabase: async () => Promise.reject(new Error("down")),
		});

		const response = await app.inject({ method: "GET", url: "/ready" });

		expect(response.statusCode).toBe(503);
		expect(response.json().checks).toEqual({ database: "error", redis: "ok" });
	});

	it("returns 503 when the redis check fails", async () => {
		const app = appWith({
			...healthy,
			checkRedis: async () => Promise.reject(new Error("down")),
		});

		const response = await app.inject({ method: "GET", url: "/ready" });

		expect(response.statusCode).toBe(503);
		expect(response.json().checks).toEqual({ database: "ok", redis: "error" });
	});
});

describe("unknown routes", () => {
	it("returns 404", async () => {
		const app = appWith(healthy);

		const response = await app.inject({ method: "GET", url: "/nope" });

		expect(response.statusCode).toBe(404);
	});
});
