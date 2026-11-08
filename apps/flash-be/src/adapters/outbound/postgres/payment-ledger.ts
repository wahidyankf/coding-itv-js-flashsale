// The mock payment provider's ledger in Postgres (decision 009): one row per reservation id, shared by every instance of
// the API, so a reservation is charged once whichever instance confirms it. Outbound Postgres adapter for the ledger the
// mock pays through. The provider is the system actor, so the system user is the author of every row.
import { type Kysely, sql } from "kysely";
import { SYSTEM_USERNAME } from "../../../domain/actors.js";
import type { LedgerEntry, PaymentLedger } from "../payment/payment-ledger.js";
import type { Database } from "./database.js";
import { dbNow, live } from "./queries.js";
import { liveUserByName } from "./users.js";

// A ledger row as the queries return it.
type Row = Pick<Database["payments"], "status" | "ref"> & { attempts: number };

// Turns a row into an entry, so no column name leaves this file.
function toEntry(row: Row): LedgerEntry {
	return {
		status: row.status,
		ref: row.ref ?? undefined,
		attempts: row.attempts,
	};
}

// The id of the system user, as a subquery, so a write names its author without a read of its own.
function systemUser(db: Kysely<Database>) {
	return liveUserByName(db, SYSTEM_USERNAME).select("id");
}

// The row of this reservation. Every read of the ledger starts here.
function rowOf(db: Kysely<Database>, reservationId: string) {
	return db
		.selectFrom("payments")
		.select(["status", "ref", "attempts"])
		.where("reservation_id", "=", reservationId)
		.where(live("payments"));
}

// The ledger over Postgres. A settle is one statement: the insert, or an update that runs only while the row is not
// charged. When another instance charged first, the update touches no row, and the stored charge is read and returned.
export function createPostgresPaymentLedger(
	db: Kysely<Database>,
): PaymentLedger {
	return {
		async find(reservationId) {
			const row = await rowOf(db, reservationId).executeTakeFirst();
			return row === undefined ? undefined : toEntry(row);
		},

		async settle(reservationId, settlement) {
			const ref = settlement.status === "charged" ? settlement.ref : null;
			const written = await db
				.insertInto("payments")
				.values({
					reservation_id: reservationId,
					status: settlement.status,
					ref,
					created_by: systemUser(db),
				})
				.onConflict((conflict) =>
					conflict
						.column("reservation_id")
						.doUpdateSet({
							status: settlement.status,
							ref,
							attempts: sql<number>`payments.attempts + 1`,
							updated_at: dbNow,
							updated_by: systemUser(db),
						})
						.where("payments.status", "<>", "charged"),
				)
				.returning(["status", "ref", "attempts"])
				.executeTakeFirst();
			if (written !== undefined) return toEntry(written);
			// The conflict above met the row, and nothing removes a ledger row, so it is there to read.
			return toEntry(await rowOf(db, reservationId).executeTakeFirstOrThrow());
		},

		async refund(ref) {
			const refunded = await db
				.updateTable("payments")
				.set({
					status: "refunded",
					updated_at: dbNow,
					updated_by: systemUser(db),
				})
				.where("ref", "=", ref)
				.where("status", "=", "charged")
				.where(live("payments"))
				.executeTakeFirst();
			return refunded.numUpdatedRows !== 0n;
		},
	};
}
