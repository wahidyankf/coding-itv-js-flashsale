import { randomUUID } from "node:crypto";
import type { Kysely } from "kysely";
import type { Database } from "../../adapters/outbound/postgres/database.js";

export type SaleSeed = {
	name?: string | undefined;
	stock?: number | undefined;
	sold?: number | undefined;
	startsAt: Date;
	endsAt: Date;
};

// Inserts the sale one scenario needs and returns its id.
export async function insertSale(
	db: Kysely<Database>,
	seed: SaleSeed,
): Promise<string> {
	const id = randomUUID();
	await db
		.insertInto("sales")
		.values({
			id,
			name: seed.name ?? "Flash sale",
			starts_at: seed.startsAt,
			ends_at: seed.endsAt,
			stock: seed.stock ?? 10,
			sold: seed.sold ?? 0,
		})
		.execute();
	return id;
}

// Removes every sale. Purchases and reservations go with them (ON DELETE CASCADE), so each scenario starts empty.
export async function resetSales(db: Kysely<Database>): Promise<void> {
	await db.deleteFrom("sales").execute();
}
