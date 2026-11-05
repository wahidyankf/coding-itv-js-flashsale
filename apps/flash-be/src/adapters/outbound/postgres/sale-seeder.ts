import { randomUUID } from "node:crypto";
import type { Kysely } from "kysely";
import type { NewSale } from "../../../application/ports/sale-seeder.js";
import type { Database } from "./database.js";

// Creates the sale and returns its id. The id is made here, so the insert needs no returned row.
export async function seedSale(
	db: Kysely<Database>,
	input: NewSale,
): Promise<string> {
	const id = randomUUID();
	await db
		.insertInto("sales")
		.values({
			id,
			name: input.name,
			starts_at: input.startsAt,
			ends_at: input.endsAt,
			stock: input.stock,
			reservation_ttl_seconds: input.reservationTtlSeconds,
			admit_per_second: input.admitPerSecond,
		})
		.execute();
	return id;
}
