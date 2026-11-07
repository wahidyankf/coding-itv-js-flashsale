// The operator's writes to sales, kept in Postgres. Each write checks and writes in one transaction, so two operators cannot
// both pass a check that only one of them can satisfy. Outbound Postgres adapter for the SaleAdmin port.
import { Err, Ok, type Result } from "@flash/typekit";
import { type Kysely, sql, type Transaction } from "kysely";
import type {
	CreateSaleStoreError,
	RemoveSaleError,
	SaleAdmin,
	UpdateSaleError,
} from "../../../application/ports/sale-admin.js";
import type { Sale } from "../../../domain/sale.js";
import type { ChangeSaleError, NewSale } from "../../../domain/sale-window.js";
import type { UserId } from "../../../domain/user.js";
import type { Database } from "./database.js";
import { dbNow, live, lockLiveSale } from "./queries.js";
import { toSale } from "./sale-repository.js";
import { seedSale } from "./sale-seeder.js";

// The number that every create and every change of a sale window takes, one at a time, so two writes of windows take
// turns. (It is named for the windows, because changes take it as well as creates.) The lock is held until the
// transaction ends.
const SALE_WINDOW_LOCK = 7_204_001;

// Takes the sale-window lock for this transaction.
async function lockSaleWindows(trx: Transaction<Database>): Promise<void> {
	await sql`select pg_advisory_xact_lock(${sql.lit(SALE_WINDOW_LOCK)})`.execute(
		trx,
	);
}

// Whether another sale uses part of the window. Two windows overlap when each opens before the other closes. `except`
// leaves one sale out, so a sale does not clash with itself. The same rule as `overlaps` in the domain (sale-window.ts);
// sale-rules_integration_tests holds the two to each other.
async function clashes(
	trx: Transaction<Database>,
	window: { startsAt: Date; endsAt: Date },
	except?: string,
): Promise<boolean> {
	let query = trx
		.selectFrom("sales")
		.select("id")
		.where(live("sales"))
		.where("starts_at", "<", window.endsAt)
		.where("ends_at", ">", window.startsAt);
	if (except !== undefined) query = query.where("id", "<>", except);
	return (await query.limit(1).executeTakeFirst()) !== undefined;
}

// Whether a live product with this id exists.
async function productExists(
	trx: Transaction<Database>,
	productId: string,
): Promise<boolean> {
	const product = await trx
		.selectFrom("products")
		.select("id")
		.where("id", "=", productId)
		.where(live("products"))
		.executeTakeFirst();
	return product !== undefined;
}

// Creates a sale, unless its window overlaps another or the product it names is missing.
function createSale(
	db: Kysely<Database>,
	input: NewSale,
	actor: UserId,
): Promise<Result<{ id: string; productId: string }, CreateSaleStoreError>> {
	return db.transaction().execute(async (trx) => {
		await lockSaleWindows(trx);
		if (await clashes(trx, input)) return new Err("sale_overlaps" as const);
		if (
			input.productId !== undefined &&
			!(await productExists(trx, input.productId))
		) {
			return new Err("product_not_found" as const);
		}
		return new Ok(await seedSale(trx, input, actor));
	});
}

// Reads a live sale under its row lock, so a purchase cannot run between this read and the write that follows.
async function lockedSale(
	trx: Transaction<Database>,
	id: string,
): Promise<Sale | undefined> {
	const row = await lockLiveSale(trx, id);
	return row === undefined ? undefined : toSale(row);
}

// Stores the new fields of a sale. The sold count and the product are not changed here.
async function writeSale(
	trx: Transaction<Database>,
	id: string,
	next: NewSale,
	actor: UserId,
): Promise<void> {
	await trx
		.updateTable("sales")
		.set({
			name: next.name,
			starts_at: next.startsAt,
			ends_at: next.endsAt,
			stock: next.stock,
			reservation_ttl_seconds: next.holdSeconds,
			admit_per_second: next.admitPerSecond,
			updated_at: dbNow,
			updated_by: actor,
		})
		.where("id", "=", id)
		.execute();
}

// Changes a sale. `decide` says what it becomes from what it is now, and the new window must not overlap another sale.
function updateSale(
	db: Kysely<Database>,
	id: string,
	decide: (current: Sale) => Result<NewSale, ChangeSaleError>,
	actor: UserId,
): Promise<Result<Sale, UpdateSaleError>> {
	return db
		.transaction()
		.execute(async (trx): Promise<Result<Sale, UpdateSaleError>> => {
			await lockSaleWindows(trx);
			const current = await lockedSale(trx, id);
			if (current === undefined) return new Err("sale_not_found");
			const next = decide(current);
			if (next.isErr()) return new Err(next.error);
			if (await clashes(trx, next.value, id)) return new Err("sale_overlaps");
			await writeSale(trx, id, next.value, actor);
			return new Ok({
				...next.value,
				id,
				productId: current.productId,
				sold: current.sold,
			});
		});
}

// Whether anyone bought an item of this sale.
async function hasPurchases(
	trx: Transaction<Database>,
	saleId: string,
): Promise<boolean> {
	const bought = await trx
		.selectFrom("purchases")
		.select("id")
		.where("sale_id", "=", saleId)
		.where(live("purchases"))
		.limit(1)
		.executeTakeFirst();
	return bought !== undefined;
}

// Marks the sale and its holds deleted. Nothing is erased. The holds go with the sale, so a rebuild of Redis no longer
// sees them.
async function markSaleDeleted(
	trx: Transaction<Database>,
	saleId: string,
	actor: UserId,
): Promise<void> {
	const deletion = {
		deleted_at: dbNow,
		deleted_by: actor,
	};
	await trx
		.updateTable("reservations")
		.set(deletion)
		.where("sale_id", "=", saleId)
		.where(live("reservations"))
		.execute();
	await trx
		.updateTable("sales")
		.set(deletion)
		.where("id", "=", saleId)
		.execute();
}

// Removes a sale that nobody bought from. A purchase takes the same row lock first (see the purchase repository), so none
// can slip in before the delete.
function removeSale(
	db: Kysely<Database>,
	id: string,
	actor: UserId,
): Promise<Result<true, RemoveSaleError>> {
	return db
		.transaction()
		.execute(async (trx): Promise<Result<true, RemoveSaleError>> => {
			const row = await lockLiveSale(trx, id);
			if (row === undefined) return new Err("sale_not_found");
			if (await hasPurchases(trx, id)) return new Err("sale_has_purchases");
			await markSaleDeleted(trx, id, actor);
			return new Ok(true as const);
		});
}

// Every live sale, the one that opens last first.
async function listSales(db: Kysely<Database>): Promise<Sale[]> {
	const rows = await db
		.selectFrom("sales")
		.selectAll()
		.where(live("sales"))
		.orderBy("starts_at", "desc")
		.execute();
	return rows.map(toSale);
}

// The operator's sale writes over Postgres. Each write runs in one transaction under the sale-window lock, so its check and
// its write cannot be split.
export function createPostgresSaleAdmin(db: Kysely<Database>): SaleAdmin {
	return {
		create: (input, actor) => createSale(db, input, actor),
		update: (id, decide, actor) => updateSale(db, id, decide, actor),
		remove: (id, actor) => removeSale(db, id, actor),
		list: () => listSales(db),
	};
}
