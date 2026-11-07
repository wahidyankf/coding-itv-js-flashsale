import { type Kysely, type Selectable, sql } from "kysely";
import type { SaleRepository } from "../../../application/ports/sale-repository.js";
import type { Sale } from "../../../domain/sale.js";
import type { Database } from "./database.js";

export function toSale(row: Selectable<Database["sales"]>): Sale {
	return {
		id: row.id,
		productId: row.product_id,
		name: row.name,
		startsAt: row.starts_at,
		endsAt: row.ends_at,
		stock: row.stock,
		sold: row.sold,
		holdSeconds: row.reservation_ttl_seconds,
		admitPerSecond: row.admit_per_second,
	};
}

export function createSaleRepository(db: Kysely<Database>): SaleRepository {
	return {
		findById: async (id) => {
			const row = await db
				.selectFrom("sales")
				.selectAll()
				.where("id", "=", id)
				.where("deleted_at", "is", null)
				.executeTakeFirst();
			return row === undefined ? undefined : toSale(row);
		},
		// Same rule as `pickCurrent`: the running sale first, else the one that opens next; a sale that is over is skipped.
		findCurrent: async (now) => {
			const row = await db
				.selectFrom("sales")
				.selectAll()
				.where("ends_at", ">", now)
				.where("deleted_at", "is", null)
				.orderBy(sql<boolean>`starts_at <= ${now}`, "desc")
				.orderBy("starts_at", "asc")
				.limit(1)
				.executeTakeFirst();
			return row === undefined ? undefined : toSale(row);
		},
	};
}
