// The hold rows of a sale as Postgres keeps them, read past the API for the integration layer. A scenario reads them to
// see that a hold taken again never overwrote the old one, and that no shopper holds two live rows.
import { type Kysely, sql } from "kysely";
import type { Database } from "../../adapters/outbound/postgres/database.js";
import type { HoldRow } from "./queue-scenario.js";

// Every hold row of the sale, deleted ones too, with the name of its shopper and of whoever marked it deleted. A row counts
// while it is live and the database clock has not passed its end.
export async function holdRowsOf(
	db: Kysely<Database>,
	saleId: string,
): Promise<HoldRow[]> {
	const rows = await db
		.selectFrom("reservations")
		.innerJoin("users as holder", "holder.id", "reservations.user_id")
		.leftJoin("users as remover", "remover.id", "reservations.deleted_by")
		.select([
			"holder.username as user",
			"reservations.id as reservationId",
			"remover.username as deletedBy",
			sql<boolean>`reservations.deleted_at is null and reservations.expires_at > now()`.as(
				"counts",
			),
		])
		.where("reservations.sale_id", "=", saleId)
		.execute();
	return rows.map((row) => ({ ...row, deletedBy: row.deletedBy ?? undefined }));
}
