// The operator's steps over the real database and the app built on it. A bought item is a purchase row and one more sold
// in Postgres, and the reads skip the rows that were deleted.
import type { FastifyInstance } from "fastify";
import { type Kysely, sql } from "kysely";
import { buildApp } from "../../adapters/inbound/http/app.js";
import {
	createDb,
	type Database,
} from "../../adapters/outbound/postgres/database.js";
import { createRedis } from "../../adapters/outbound/redis/redis-client.js";
import { dependenciesFrom } from "../../composition.js";
import { config } from "../../config.js";
import { operatorWorld } from "./operating.js";
import { insertProduct, insertPurchase, loginAs } from "./seed.js";

// One scenario over the real database and the app built on it. A bought item is a purchase row and one more sold.
function integrationOperatingWorld(db: Kysely<Database>, app: FastifyInstance) {
	return operatorWorld({
		app: () => app,
		now: () => new Date(),
		login: (username, role) => loginAs(db, username, role),
		buyItem: async (saleId) => {
			await insertPurchase(db, { saleId, user: "ana" });
			await db
				.updateTable("sales")
				.set({ sold: sql`sold + 1` })
				.where("id", "=", saleId)
				.execute();
		},
		// Count only live rows: a removed sale stays in the table, marked deleted.
		salesCount: async () =>
			(
				await db
					.selectFrom("sales")
					.select("id")
					.where("deleted_at", "is", null)
					.execute()
			).length,
		makeProduct: (name) => insertProduct(db, name),
		productsOfSales: async () =>
			(
				await db
					.selectFrom("sales")
					.select("product_id")
					.distinct()
					.where("deleted_at", "is", null)
					.execute()
			).map((row) => row.product_id),
		deletedBy: async (saleId) =>
			(
				await db
					.selectFrom("sales")
					.select("deleted_by")
					.where("id", "=", saleId)
					.where("deleted_at", "is not", null)
					.executeTakeFirst()
			)?.deleted_by ?? undefined,
		idOf: async (username) =>
			(
				await db
					.selectFrom("users")
					.select("id")
					.where("username", "=", username)
					.where("deleted_at", "is", null)
					.executeTakeFirst()
			)?.id,
	});
}

// Opens the run's connections and the app the operator scenarios use. The sale cache is off, so a read shows a change at
// once. `newWorld()` makes one scenario over them; `close` ends the connections when the run ends.
export async function openOperatingIntegration() {
	const db = createDb(config.databaseUrl);
	const redis = await createRedis(config.redisUrl);
	const app = buildApp(
		dependenciesFrom(db, redis, { ...config, saleCacheMs: 0 }),
		{ cookieSecure: false },
	);
	return {
		db,
		newWorld: () => integrationOperatingWorld(db, app),
		async close() {
			await app.close();
			await redis.close();
			await db.destroy();
		},
	};
}
