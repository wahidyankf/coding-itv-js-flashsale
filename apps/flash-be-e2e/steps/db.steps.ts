import { expect } from "@playwright/test";
import { createBdd } from "playwright-bdd";
import {
	createScratchDatabase,
	migrate,
	migratedDatabase,
	query,
	world,
} from "./support/world.js";

const { Given, When, Then } = createBdd();

const TABLES = ["sales", "purchases", "reservations"];

async function exists(table: string): Promise<boolean> {
	const rows = await query<{ name: string | null }>(
		"select to_regclass($1) as name",
		[`public.${table}`],
	);
	return rows[0]?.name === table;
}

async function insertSale(stock: number, sold: number): Promise<string> {
	const rows = await query<{ id: string }>(
		`insert into sales (name, starts_at, ends_at, stock, sold)
		 values ('Flash sale', now() - interval '1 hour', now() + interval '1 hour', $1, $2)
		 returning id`,
		[stock, sold],
	);
	const id = rows[0]?.id;
	if (!id) throw new Error("the sale was not inserted");
	return id;
}

Given("a database with no tables", async () => {
	await createScratchDatabase();
});

Given("a database migrated to the latest version", async () => {
	await migratedDatabase();
});

When("the migrations run to the latest version", () => {
	migrate();
});

Then("the sales, purchases and reservations tables exist", async () => {
	for (const table of TABLES) expect(await exists(table)).toBe(true);
});

Then("the products table does not exist", async () => {
	expect(await exists("products")).toBe(false);
});

When("a sale with stock 5 and 6 sold is inserted", async () => {
	try {
		await insertSale(5, 6);
	} catch (error) {
		world.failure = (error as Error).message;
	}
});

Then("the database refuses the row", () => {
	expect(world.failure).toContain("sales_sold_within_stock");
});

Given("a sale with stock 5 exists", async () => {
	world.saleId = await insertSale(5, 0);
});

When(
	/^the user "([^"]+)" is recorded as a buyer twice in that sale$/,
	async ({ request: _request }, user: string) => {
		try {
			for (let attempt = 0; attempt < 2; attempt++) {
				await query(
					`insert into purchases (sale_id, user_id, reservation_id, payment_ref)
					 values ($1, $2, gen_random_uuid(), $3)`,
					[world.saleId, user, `pay-${attempt}`],
				);
			}
		} catch (error) {
			world.failure = (error as Error).message;
		}
	},
);

Then("the database refuses the second purchase", () => {
	expect(world.failure).toContain("purchases_one_per_user");
});
