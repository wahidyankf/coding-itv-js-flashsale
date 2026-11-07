import { type APIRequestContext, expect } from "@playwright/test";
import { createBdd } from "playwright-bdd";
import { bodyOf, routes, send } from "./support/api.js";
import { createSale } from "./support/operator.js";
import { currentResponse, setResponse } from "./support/response.js";
import { relativeTime } from "./support/time.js";
import { migratedDatabase, query, world } from "./support/world.js";

const { Given, When, Then } = createBdd();

async function ensureDatabase(): Promise<void> {
	if (!world.databaseUrl) await migratedDatabase();
}

// A sale made with SQL. Only for a state real traffic cannot produce, such as items sold before the sale opens.
async function insertSale(
	name: string,
	startsAt: Date,
	endsAt: Date,
	stock: number,
	sold: number,
): Promise<string> {
	const rows = await query<{ id: string }>(
		`insert into sales (name, starts_at, ends_at, stock, sold)
		 values ($1, $2, $3, $4, $5) returning id`,
		[name, startsAt, endsAt, stock, sold],
	);
	const id = rows[0]?.id;
	if (!id) throw new Error("the sale was not inserted");
	return id;
}

Given(
	/^a sale with stock (\d+) and (\d+) sold that opens (.+) and closes (.+)$/,
	async (
		{ request },
		stock: string,
		sold: string,
		opens: string,
		closes: string,
	) => {
		await ensureDatabase();
		const now = new Date();
		const startsAt = relativeTime(opens, now);
		const endsAt = relativeTime(closes, now);
		// A sale with nothing sold is set up like an operator does it. One with items sold already needs a row.
		world.saleId =
			Number(sold) === 0
				? await createSale(request, { stock: Number(stock), startsAt, endsAt })
				: await insertSale(
						"Flash sale",
						startsAt,
						endsAt,
						Number(stock),
						Number(sold),
					);
	},
);

const saleIds = new Map<string, string>();

Given(
	/^a sale named "([^"]+)" that opens (.+) and closes (.+)$/,
	async ({ request }, name: string, opens: string, closes: string) => {
		await ensureDatabase();
		const now = new Date();
		saleIds.set(
			name,
			await createSale(request, {
				name,
				stock: 10,
				startsAt: relativeTime(opens, now),
				endsAt: relativeTime(closes, now),
			}),
		);
	},
);

// The scenario's database is brand new, so it holds no sale until a step adds one.
Given("no sale exists", async () => {
	await ensureDatabase();
});

When("a client asks for that sale", async ({ request }) => {
	setResponse(
		await send(request, routes.sale, {
			params: { saleId: world.saleId ?? "" },
		}),
	);
});

When("a client asks for the current sale", async ({ request }) => {
	setResponse(await send(request, routes.currentSale, {}));
});

When(
	/^a client asks for the sale with id "([^"]+)"$/,
	async ({ request }, id: string) => {
		setResponse(await send(request, routes.sale, { params: { saleId: id } }));
	},
);

// Reads the sale again, so the answer is the state now and not the body of the last response.
async function saleNow(request: APIRequestContext) {
	return bodyOf(
		routes.sale,
		await send(request, routes.sale, {
			params: { saleId: world.saleId ?? "" },
		}),
	);
}

Then(/^the sale status is "([^"]+)"$/, async ({ request }, status: string) => {
	expect((await saleNow(request))?.status).toBe(status);
});

Then(
	/^the sale named "([^"]+)" has the status "([^"]+)" when read by its id$/,
	async ({ request }, name: string, status: string) => {
		const sale = await bodyOf(
			routes.sale,
			await send(request, routes.sale, {
				params: { saleId: saleIds.get(name) ?? "" },
			}),
		);
		expect(sale?.status).toBe(status);
	},
);

Then(/^(\d+) items remain$/, async ({ request }, remaining: string) => {
	expect((await saleNow(request))?.remaining).toBe(Number(remaining));
});

Then(
	/^the sale name is "([^"]+)"$/,
	async ({ request: _request }, name: string) => {
		expect((await currentResponse().json()).name).toBe(name);
	},
);

Then(
	/^the error message is "([^"]+)"$/,
	async ({ request: _request }, message: string) => {
		expect((await currentResponse().json()).errorMessage).toBe(message);
	},
);

Then(
	/^the error is "([^"]+)"$/,
	async ({ request: _request }, error: string) => {
		expect((await currentResponse().json()).errorCode).toBe(error);
	},
);
