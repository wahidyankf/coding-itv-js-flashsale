import type { FastifyInstance } from "fastify";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp, dependenciesFrom } from "./app.js";
import { config } from "./config.js";
import { createDb } from "./db.js";
import { createMigrator } from "./migrator.js";
import { createRedis } from "./redis.js";

// Needs Postgres and Redis from compose.dev.yaml (npm run db:up in the root).
describe("flash-be against real Postgres and Redis", () => {
	const db = createDb(config.databaseUrl);
	let redis: Awaited<ReturnType<typeof createRedis>>;
	let app: FastifyInstance;

	beforeAll(async () => {
		const { error } = await createMigrator(db).migrateToLatest();
		if (error) throw error;

		redis = await createRedis(config.redisUrl);
		app = buildApp(dependenciesFrom(db, redis));
	});

	afterAll(async () => {
		await app.close();
		await redis.close();
		await db.destroy();
	});

	it("applies migrations and creates the products table", async () => {
		const result = await sql<{
			name: string | null;
		}>`select to_regclass('public.products') as name`.execute(db);

		expect(result.rows[0]?.name).toBe("products");
	});

	it("reports ready when Postgres and Redis answer", async () => {
		const response = await app.inject({ method: "GET", url: "/ready" });

		expect(response.statusCode).toBe(200);
		expect(response.json().checks).toEqual({ database: "ok", redis: "ok" });
	});
});
