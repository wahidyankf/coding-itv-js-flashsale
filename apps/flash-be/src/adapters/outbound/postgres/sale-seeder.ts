import { randomUUID } from "node:crypto";
import type { Kysely } from "kysely";
import type { NewSale } from "../../../application/ports/sale-seeder.js";
import type { Database } from "./database.js";

// The live product of this name, made if there is none. Two products may share a name, so the oldest one is taken.
async function productNamed(
	db: Kysely<Database>,
	name: string,
	actor: string,
): Promise<string> {
	const found = await db
		.selectFrom("products")
		.select("id")
		.where("name", "=", name)
		.where("deleted_at", "is", null)
		.orderBy("created_at", "asc")
		.limit(1)
		.executeTakeFirst();
	if (found !== undefined) return found.id;
	const id = randomUUID();
	await db
		.insertInto("products")
		.values({ id, name, created_by: actor })
		.execute();
	return id;
}

// Creates the sale and returns its id and its product. The ids are made here, so the insert needs no returned row. A sale
// that names no product gets the product of its name.
export async function seedSale(
	db: Kysely<Database>,
	input: NewSale,
	actor: string,
): Promise<{ id: string; productId: string }> {
	const id = randomUUID();
	const productId =
		input.productId ?? (await productNamed(db, input.name, actor));
	await db
		.insertInto("sales")
		.values({
			id,
			product_id: productId,
			name: input.name,
			starts_at: input.startsAt,
			ends_at: input.endsAt,
			stock: input.stock,
			reservation_ttl_seconds: input.reservationTtlSeconds,
			admit_per_second: input.admitPerSecond,
			created_by: actor,
		})
		.execute();
	return { id, productId };
}
