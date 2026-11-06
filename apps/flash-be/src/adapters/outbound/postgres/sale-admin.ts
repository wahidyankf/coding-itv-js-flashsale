import { Err, Ok } from "@flash/typekit";
import { type Kysely, sql } from "kysely";
import type { SaleAdmin } from "../../../application/ports/sale-admin.js";
import type { Database } from "./database.js";
import { seedSale } from "./sale-seeder.js";

// One number for every create, so two creates take turns. The lock is held until the transaction ends.
const CREATE_LOCK = 7_204_001;

export function createPostgresSaleAdmin(db: Kysely<Database>): SaleAdmin {
	return {
		create: (input) =>
			db.transaction().execute(async (trx) => {
				await sql`select pg_advisory_xact_lock(${sql.lit(CREATE_LOCK)})`.execute(
					trx,
				);
				// Two windows overlap when each opens before the other closes.
				const clash = await trx
					.selectFrom("sales")
					.select("id")
					.where("starts_at", "<", input.endsAt)
					.where("ends_at", ">", input.startsAt)
					.limit(1)
					.executeTakeFirst();
				if (clash) return new Err("sale_overlaps" as const);
				return new Ok(await seedSale(trx, input));
			}),
	};
}
