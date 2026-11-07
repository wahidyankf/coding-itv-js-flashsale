import { Err, Ok, type Result } from "@flash/typekit";
import { type Kysely, sql, type Transaction } from "kysely";
import type {
	RemoveSaleError,
	SaleAdmin,
	UpdateSaleError,
} from "../../../application/ports/sale-admin.js";
import type { Sale } from "../../../domain/sale.js";
import type { Database } from "./database.js";
import { toSale } from "./sale-repository.js";
import { seedSale } from "./sale-seeder.js";

// One number for every create and change, so two writes of a window take turns. The lock is held until the transaction ends.
const CREATE_LOCK = 7_204_001;

// Whether another sale uses part of the window. Two windows overlap when each opens before the other closes.
async function clashes(
	trx: Transaction<Database>,
	window: { startsAt: Date; endsAt: Date },
	except?: string,
): Promise<boolean> {
	let query = trx
		.selectFrom("sales")
		.select("id")
		.where("deleted_at", "is", null)
		.where("starts_at", "<", window.endsAt)
		.where("ends_at", ">", window.startsAt);
	if (except !== undefined) query = query.where("id", "<>", except);
	return (await query.limit(1).executeTakeFirst()) !== undefined;
}

export function createPostgresSaleAdmin(db: Kysely<Database>): SaleAdmin {
	return {
		create: (input, actor) =>
			db.transaction().execute(async (trx) => {
				await sql`select pg_advisory_xact_lock(${sql.lit(CREATE_LOCK)})`.execute(
					trx,
				);
				if (await clashes(trx, input)) return new Err("sale_overlaps" as const);
				if (input.productId !== undefined) {
					const product = await trx
						.selectFrom("products")
						.select("id")
						.where("id", "=", input.productId)
						.where("deleted_at", "is", null)
						.executeTakeFirst();
					if (product === undefined) {
						return new Err("product_not_found" as const);
					}
				}
				return new Ok(await seedSale(trx, input, actor));
			}),

		update: (id, decide, actor) =>
			db
				.transaction()
				.execute(async (trx): Promise<Result<Sale, UpdateSaleError>> => {
					await sql`select pg_advisory_xact_lock(${sql.lit(CREATE_LOCK)})`.execute(
						trx,
					);
					// The row lock keeps a purchase from running between the read and the write.
					const row = await trx
						.selectFrom("sales")
						.selectAll()
						.where("id", "=", id)
						.where("deleted_at", "is", null)
						.forUpdate()
						.executeTakeFirst();
					if (row === undefined) return new Err("sale_not_found");
					const current = toSale(row);
					const next = decide(current);
					if (next.isErr()) return new Err(next.error);
					if (await clashes(trx, next.value, id))
						return new Err("sale_overlaps");
					await trx
						.updateTable("sales")
						.set({
							name: next.value.name,
							starts_at: next.value.startsAt,
							ends_at: next.value.endsAt,
							stock: next.value.stock,
							reservation_ttl_seconds: next.value.reservationTtlSeconds,
							admit_per_second: next.value.admitPerSecond,
							updated_at: sql<Date>`now()`,
							updated_by: actor,
						})
						.where("id", "=", id)
						.execute();
					return new Ok({
						...next.value,
						id,
						productId: current.productId,
						sold: current.sold,
					});
				}),

		remove: (id, actor) =>
			db
				.transaction()
				.execute(async (trx): Promise<Result<true, RemoveSaleError>> => {
					// A purchase takes this row lock first (see the purchase repository), so none can slip in before the delete.
					const row = await trx
						.selectFrom("sales")
						.select("id")
						.where("id", "=", id)
						.where("deleted_at", "is", null)
						.forUpdate()
						.executeTakeFirst();
					if (row === undefined) return new Err("sale_not_found");
					const bought = await trx
						.selectFrom("purchases")
						.select("id")
						.where("sale_id", "=", id)
						.where("deleted_at", "is", null)
						.limit(1)
						.executeTakeFirst();
					if (bought !== undefined) return new Err("sale_has_purchases");
					// Nothing is erased. The holds are marked deleted with the sale, so a rebuild of Redis no longer sees them.
					const deletion = {
						deleted_at: sql<Date>`now()`,
						deleted_by: actor,
					};
					await trx
						.updateTable("reservations")
						.set(deletion)
						.where("sale_id", "=", id)
						.where("deleted_at", "is", null)
						.execute();
					await trx
						.updateTable("sales")
						.set(deletion)
						.where("id", "=", id)
						.execute();
					return new Ok(true as const);
				}),

		list: async () => {
			const rows = await db
				.selectFrom("sales")
				.selectAll()
				.where("deleted_at", "is", null)
				.orderBy("starts_at", "desc")
				.execute();
			return rows.map(toSale);
		},
	};
}
