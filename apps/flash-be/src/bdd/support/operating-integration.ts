import type { FastifyInstance } from "fastify";
import { type Kysely, sql } from "kysely";
import type { Database } from "../../adapters/outbound/postgres/database.js";
import { operatorWorld } from "./operating.js";
import { insertProduct, insertPurchase, loginAs } from "./seed.js";

// One scenario over the real database and the app built on it. A bought item is a purchase row and one more sold.
export function integrationOperatingWorld(
	db: Kysely<Database>,
	app: FastifyInstance,
) {
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
		// Rows marked deleted are not sales any more.
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
