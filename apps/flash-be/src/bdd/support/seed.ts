// Test data written straight to Postgres, past the API: products, sales, purchases and logins. Only tests use these
// helpers, because the API never deletes a row.

import { randomUUID } from "node:crypto";
import { MS_PER_HOUR } from "@flash/flash-commons";
import { type Kysely, sql } from "kysely";
import { ACCESS_COOKIE } from "../../adapters/inbound/http/cookies.js";
import { randomTokenSource } from "../../adapters/outbound/crypto/token-source.js";
import type { Database } from "../../adapters/outbound/postgres/database.js";
import { actorId, ensureUser } from "../../adapters/outbound/postgres/users.js";
import { SYSTEM_USERNAME } from "../../domain/actors.js";
import { hashToken, type Role } from "../../domain/auth.js";

// The fields a scenario gives a sale when it writes one to Postgres. A field left out takes the seed's default.
export type SaleSeed = {
	name?: string | undefined;
	stock?: number | undefined;
	sold?: number | undefined;
	// A product the scenario made earlier. Left out, the sale gets a product of its own.
	productId?: string | undefined;
	startsAt: Date;
	endsAt: Date;
};

// Inserts a product and returns its id.
export async function insertProduct(
	db: Kysely<Database>,
	name = "Flash sale",
): Promise<string> {
	const id = randomUUID();
	await db
		.insertInto("products")
		.values({ id, name, created_by: await actorId(db, SYSTEM_USERNAME) })
		.execute();
	return id;
}

// Inserts the sale one scenario needs and returns its id.
export async function insertSale(
	db: Kysely<Database>,
	seed: SaleSeed,
): Promise<string> {
	const id = randomUUID();
	const name = seed.name ?? "Flash sale";
	const productId = seed.productId ?? (await insertProduct(db, name));
	await db
		.insertInto("sales")
		.values({
			id,
			product_id: productId,
			name,
			starts_at: seed.startsAt,
			ends_at: seed.endsAt,
			stock: seed.stock ?? 10,
			sold: seed.sold ?? 0,
			created_by: await actorId(db, SYSTEM_USERNAME),
		})
		.execute();
	return id;
}

// Inserts a purchase row, as a shopper's purchase would leave it. It does not count the item as sold.
export async function insertPurchase(
	db: Kysely<Database>,
	purchase: {
		saleId: string;
		user: string;
		reservationId?: string | undefined;
		paymentRef?: string | undefined;
	},
): Promise<void> {
	const userId = await ensureUser(db, purchase.user);
	await db
		.insertInto("purchases")
		.values({
			sale_id: purchase.saleId,
			user_id: userId,
			reservation_id: purchase.reservationId ?? randomUUID(),
			payment_ref: purchase.paymentRef ?? `pay-${purchase.user}`,
			created_by: userId,
		})
		.execute();
}

// Makes a login with no password, for tests that need one, and returns its cookie header. A new user is a shopper
// unless the role says otherwise.
export async function loginAs(
	db: Kysely<Database>,
	username: string,
	role: Role = "shopper",
): Promise<string> {
	const userId = await ensureUser(db, username);
	if (role !== "shopper") {
		await db
			.updateTable("users")
			.set({ role })
			.where("id", "=", userId)
			.execute();
	}
	const token = randomTokenSource();
	const hour = MS_PER_HOUR;
	await db
		.insertInto("sessions")
		.values({
			user_id: userId,
			access_hash: hashToken(token),
			access_expires_at: new Date(Date.now() + hour),
			refresh_hash: hashToken(randomTokenSource()),
			refresh_expires_at: new Date(Date.now() + 24 * hour),
			created_by: userId,
		})
		.execute();
	return `${ACCESS_COOKIE}=${token}`;
}

// Empties the tables, so each scenario starts with no sale. Only tests do this, because product code never deletes a row.
// The two users the migration made stay, and so does every table that nothing here refers to.
export async function resetSales(db: Kysely<Database>): Promise<void> {
	await sql`truncate table sessions, sales, purchases, reservations, products cascade`.execute(
		db,
	);
	await sql`delete from users where username <> ${SYSTEM_USERNAME}`.execute(db);
}
