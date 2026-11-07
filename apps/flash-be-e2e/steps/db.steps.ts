import { expect } from "@playwright/test";
import { createBdd } from "playwright-bdd";
import {
	createScratchDatabase,
	migrate,
	migratedDatabase,
	query,
	SYSTEM_USER,
	world,
} from "./support/world.js";

const { Given, When, Then } = createBdd();

const TABLES = [
	"sales",
	"purchases",
	"reservations",
	"products",
	"users",
	"sessions",
];
const AUDIT_COLUMNS = [
	"created_at",
	"created_by",
	"updated_at",
	"updated_by",
	"deleted_at",
	"deleted_by",
];

async function exists(table: string): Promise<boolean> {
	const rows = await query<{ name: string | null }>(
		"select to_regclass($1) as name",
		[`public.${table}`],
	);
	return rows[0]?.name === table;
}

// These scenarios test the constraints of the tables, so they write rows the API would never allow (more sold than
// stock). That is why they use SQL.
async function insertSale(stock: number, sold: number): Promise<string> {
	const rows = await query<{ id: string }>(
		`with product as (
		   insert into products (name, created_by) values ('Flash sale', ${SYSTEM_USER}) returning id
		 )
		 insert into sales (product_id, name, starts_at, ends_at, stock, sold, created_by)
		 select product.id, 'Flash sale', now() - interval '1 hour', now() + interval '1 hour', $1, $2, ${SYSTEM_USER}
		 from product
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

Then(
	"the sales, purchases, reservations, products, users and sessions tables exist",
	async () => {
		for (const table of TABLES) expect(await exists(table)).toBe(true);
	},
);

Then(
	"each of those tables has the columns created_at, created_by, updated_at, updated_by, deleted_at and deleted_by",
	async () => {
		for (const table of TABLES) {
			const rows = await query<{ name: string }>(
				"select column_name as name from information_schema.columns where table_name = $1",
				[table],
			);
			const names = rows.map((row) => row.name);
			for (const column of AUDIT_COLUMNS) {
				expect(names, `${table}.${column}`).toContain(column);
			}
		}
	},
);

Then(
	/^the users table holds only the user "([^"]+)"$/,
	async ({ request: _request }, system: string) => {
		const rows = await query<{ username: string }>(
			"select username from users where deleted_at is null order by username",
		);
		expect(rows.map((row) => row.username)).toEqual([system]);
	},
);

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

When("a sale with no product is inserted", async () => {
	try {
		await query(
			`insert into sales (name, starts_at, ends_at, stock, created_by)
			 values ('Flash sale', now(), now() + interval '1 hour', 5, ${SYSTEM_USER})`,
		);
	} catch (error) {
		world.failure = (error as Error).message;
	}
});

Then("the database refuses the sale because its product is missing", () => {
	expect(world.failure).toContain("product_id");
});

When(
	/^the user "([^"]+)" is recorded as a buyer twice in that sale$/,
	async ({ request: _request }, user: string) => {
		try {
			const users = await query<{ id: string }>(
				`insert into users (username, created_by) values ($1, ${SYSTEM_USER}) returning id`,
				[user],
			);
			const userId = users[0]?.id;
			for (let attempt = 0; attempt < 2; attempt++) {
				await query(
					`insert into purchases (sale_id, user_id, reservation_id, payment_ref, created_by)
					 values ($1, $2, gen_random_uuid(), $3, $2)`,
					[world.saleId, userId, `pay-${attempt}`],
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

When(
	/^a user with the role "([^"]+)" is inserted$/,
	async ({ request: _request }, role: string) => {
		try {
			await query(
				`insert into users (username, role, created_by) values ('ana', $1, ${SYSTEM_USER})`,
				[role],
			);
		} catch (error) {
			world.failure = (error as Error).message;
		}
	},
);

Then("the database refuses the user because its role is unknown", () => {
	expect(world.failure).toContain("users_role_known");
});
