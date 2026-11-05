import type { Kysely, Selectable } from "kysely";
import type { Database } from "../db.js";
import type { Sale } from "./sale.js";

export type SaleRepository = {
	findById: (id: string) => Promise<Sale | undefined>;
	// The current sale is the one that opens last.
	findCurrent: () => Promise<Sale | undefined>;
};

function toSale(row: Selectable<Database["sales"]>): Sale {
	return {
		id: row.id,
		name: row.name,
		startsAt: row.starts_at,
		endsAt: row.ends_at,
		stock: row.stock,
		sold: row.sold,
		reservationTtlSeconds: row.reservation_ttl_seconds,
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
				.executeTakeFirst();
			return row ? toSale(row) : undefined;
		},
		findCurrent: async () => {
			const row = await db
				.selectFrom("sales")
				.selectAll()
				.orderBy("starts_at", "desc")
				.limit(1)
				.executeTakeFirst();
			return row ? toSale(row) : undefined;
		},
	};
}
