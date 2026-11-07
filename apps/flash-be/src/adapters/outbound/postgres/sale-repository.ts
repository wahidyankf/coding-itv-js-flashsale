// The sale reads over Postgres, and the row-to-sale mapping that the admin and the seeder also use. Outbound Postgres
// adapter for the SaleRepository port.
import { type Kysely, type Selectable, sql } from "kysely";
import type { SaleRepository } from "../../../application/ports/sale-repository.js";
import type { Sale } from "../../../domain/sale.js";
import type { Database } from "./database.js";
import { live } from "./queries.js";

// A sale row, as the domain knows a sale. The column names are the database's; the fields are the domain's.
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

// The sale reads: one sale by id, and the sale the shoppers see now. A deleted sale is never returned.
export function createSaleRepository(db: Kysely<Database>): SaleRepository {
	return {
		findById: async (id) => {
			const row = await db
				.selectFrom("sales")
				.selectAll()
				.where("id", "=", id)
				.where(live("sales"))
				.executeTakeFirst();
			return row === undefined ? undefined : toSale(row);
		},
		// Same rule as `pickCurrent` (domain/sale.ts): the running sale first, else the one that opens next; a sale that is over
		// is skipped. sale-rules_integration_tests checks the two at the same moments.
		findCurrent: async (now) => {
			const row = await db
				.selectFrom("sales")
				.selectAll()
				.where("ends_at", ">", now)
				.where(live("sales"))
				.orderBy(sql<boolean>`starts_at <= ${now}`, "desc")
				.orderBy("starts_at", "asc")
				.limit(1)
				.executeTakeFirst();
			return row === undefined ? undefined : toSale(row);
		},
	};
}
