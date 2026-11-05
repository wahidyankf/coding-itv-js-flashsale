import { expect } from "@playwright/test";
import { createBdd } from "playwright-bdd";
import { currentResponse, setResponse } from "./support/response.js";
import { migratedDatabase, query, startApi, world } from "./support/world.js";

const { Given, When, Then } = createBdd();

const HOUR_MS = 3_600_000;

// Reads phrases such as "in 2 hours" and "1 hour ago" against a given moment.
function relativeTime(phrase: string, now: Date): Date {
	const ahead = /^in (\d+) hours?$/.exec(phrase);
	if (ahead) return new Date(now.getTime() + Number(ahead[1]) * HOUR_MS);
	const past = /^(\d+) hours? ago$/.exec(phrase);
	if (past) return new Date(now.getTime() - Number(past[1]) * HOUR_MS);
	throw new Error(`cannot read the time "${phrase}"`);
}

async function ensureDatabase(): Promise<void> {
	if (!world.databaseUrl) await migratedDatabase();
}

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
		{ request: _request },
		stock: string,
		sold: string,
		opens: string,
		closes: string,
	) => {
		await ensureDatabase();
		const now = new Date();
		world.saleId = await insertSale(
			"Flash sale",
			relativeTime(opens, now),
			relativeTime(closes, now),
			Number(stock),
			Number(sold),
		);
	},
);

Given(
	/^a sale named "([^"]+)" that opened (.+)$/,
	async ({ request: _request }, name: string, opened: string) => {
		await ensureDatabase();
		const startsAt = relativeTime(opened, new Date());
		await insertSale(
			name,
			startsAt,
			new Date(startsAt.getTime() + 6 * HOUR_MS),
			10,
			0,
		);
	},
);

// The scenario's database is brand new, so it holds no sale until a step adds one.
Given("no sale exists", async () => {
	await ensureDatabase();
});

When("a client asks for that sale", async ({ request }) => {
	const url = await startApi();
	setResponse(await request.get(`${url}/sales/${world.saleId}`));
});

When("a client asks for the current sale", async ({ request }) => {
	const url = await startApi();
	setResponse(await request.get(`${url}/sales/current`));
});

When(
	/^a client asks for the sale with id "([^"]+)"$/,
	async ({ request }, id: string) => {
		const url = await startApi();
		setResponse(await request.get(`${url}/sales/${id}`));
	},
);

Then(
	/^the sale status is "([^"]+)"$/,
	async ({ request: _request }, status: string) => {
		expect((await currentResponse().json()).status).toBe(status);
	},
);

Then(
	/^(\d+) items remain$/,
	async ({ request: _request }, remaining: string) => {
		expect((await currentResponse().json()).remaining).toBe(Number(remaining));
	},
);

Then(
	/^the sale name is "([^"]+)"$/,
	async ({ request: _request }, name: string) => {
		expect((await currentResponse().json()).name).toBe(name);
	},
);

Then(
	/^the error is "([^"]+)"$/,
	async ({ request: _request }, error: string) => {
		expect((await currentResponse().json()).error).toBe(error);
	},
);
