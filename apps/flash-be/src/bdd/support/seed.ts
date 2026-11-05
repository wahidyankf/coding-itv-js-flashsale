import type { Kysely } from "kysely";
import type { Database } from "../../db.js";

export type ProductSeed = { name: string };

// Inserts the rows one scenario needs. A scenario seeds its own scratch database, so rows never leak
// from one scenario to another.
export async function seedProducts(
	db: Kysely<Database>,
	rows: ProductSeed[],
): Promise<void> {
	if (rows.length === 0) return;
	await db.insertInto("products").values(rows).execute();
}
