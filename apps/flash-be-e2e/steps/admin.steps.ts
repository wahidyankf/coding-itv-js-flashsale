import { type APIResponse, expect } from "@playwright/test";
import { createBdd } from "playwright-bdd";
import { bodyOf, routes, send } from "./support/api.js";
import { operatorCookie, shopperCookie } from "./support/auth.js";
import { type Sender, senderHeaders } from "./support/operator.js";
import { currentResponse, setResponse } from "./support/response.js";
import {
	migratedDatabase,
	query,
	SYSTEM_USER,
	world,
} from "./support/world.js";

const { Given, When, Then } = createBdd();

const MINUTE_MS = 60_000;

// The responses of operators who created at the same moment.
let racers: APIResponse[] = [];

async function ensureDatabase(): Promise<void> {
	if (!world.databaseUrl) await migratedDatabase();
}

async function create(
	request: Parameters<typeof send>[0],
	stock: number,
	startsIn: number,
	minutes: number,
	sender: Sender,
	productId?: string,
): Promise<APIResponse> {
	// A request from nobody has no login to set the database up first.
	await ensureDatabase();
	const startsAt = new Date(Date.now() + startsIn * MINUTE_MS);
	return send(request, routes.createSale, {
		headers: await senderHeaders(request, sender),
		body: {
			stock,
			startsAt: startsAt.toISOString(),
			endsAt: new Date(startsAt.getTime() + minutes * MINUTE_MS).toISOString(),
			...(productId === undefined ? {} : { productId }),
		},
	});
}

Given("an operator is logged in", async ({ request }) => {
	await ensureDatabase();
	await operatorCookie(request);
});

Given("a shopper is logged in", async ({ request }) => {
	await ensureDatabase();
	await shopperCookie(request, "ana");
});

Given(
	/^a sale was created with stock (\d+), opening in (\d+) minutes for (\d+) minutes$/,
	async ({ request }, stock: string, startsIn: string, minutes: string) => {
		const made = await create(
			request,
			Number(stock),
			Number(startsIn),
			Number(minutes),
			"operator",
			world.productId,
		);
		expect(made.status()).toBe(201);
		world.saleId = (await made.json()).id;
	},
);

// There is no route for a product, so the scenario writes the row, as the system.
Given(
	/^a product named "([^"]+)" exists$/,
	async ({ request: _request }, name: string) => {
		const rows = await query<{ id: string }>(
			`insert into products (name, created_by) values ($1, ${SYSTEM_USER}) returning id`,
			[name],
		);
		world.productId = rows[0]?.id;
	},
);

type Request = Parameters<typeof send>[0];

async function createAs(
	sender: Sender,
	request: Request,
	stock: string,
	startsIn: string,
	minutes: string,
) {
	setResponse(
		await create(
			request,
			Number(stock),
			Number(startsIn),
			Number(minutes),
			sender,
		),
	);
}

When(
	/^the operator creates a sale with stock (\d+), opening in (\d+) minutes for (\d+) minutes$/,
	async ({ request }, stock: string, startsIn: string, minutes: string) => {
		await createAs("operator", request, stock, startsIn, minutes);
	},
);

When(
	/^the shopper creates a sale with stock (\d+), opening in (\d+) minutes for (\d+) minutes$/,
	async ({ request }, stock: string, startsIn: string, minutes: string) => {
		await createAs("shopper", request, stock, startsIn, minutes);
	},
);

When(
	/^someone who is not logged in creates a sale with stock (\d+), opening in (\d+) minutes for (\d+) minutes$/,
	async ({ request }, stock: string, startsIn: string, minutes: string) => {
		await createAs("nobody", request, stock, startsIn, minutes);
	},
);

When(
	/^the operator creates a sale of that product with stock (\d+), opening in (\d+) minutes for (\d+) minutes$/,
	async ({ request }, stock: string, startsIn: string, minutes: string) => {
		setResponse(
			await create(
				request,
				Number(stock),
				Number(startsIn),
				Number(minutes),
				"operator",
				world.productId,
			),
		);
	},
);

When(
	/^the operator creates a sale of a product that does not exist with stock (\d+), opening in (\d+) minutes for (\d+) minutes$/,
	async ({ request }, stock: string, startsIn: string, minutes: string) => {
		setResponse(
			await create(
				request,
				Number(stock),
				Number(startsIn),
				Number(minutes),
				"operator",
				"00000000-0000-4000-8000-000000000000",
			),
		);
	},
);

When(
	/^(\d+) operators create a sale with stock (\d+), opening in (\d+) minutes for (\d+) minutes, at the same moment$/,
	async (
		{ request },
		operators: string,
		stock: string,
		startsIn: string,
		minutes: string,
	) => {
		racers = await Promise.all(
			Array.from({ length: Number(operators) }, () =>
				create(
					request,
					Number(stock),
					Number(startsIn),
					Number(minutes),
					"operator",
				),
			),
		);
	},
);

Then(
	/^the new sale is "([^"]+)" with (\d+) items remaining$/,
	async ({ request: _request }, status: string, remaining: string) => {
		const made = await currentResponse().json();
		expect(made.status).toBe(status);
		expect(made.remaining).toBe(Number(remaining));
	},
);

Then("the current sale is the new sale", async ({ request }) => {
	const made = await currentResponse().json();
	const current = await bodyOf(
		routes.currentSale,
		await send(request, routes.currentSale, {}),
	);
	expect(current?.id).toBe(made.id);
});

Then("the new sale sells that product", async ({ request: _request }) => {
	expect((await currentResponse().json()).productId).toBe(world.productId);
	const rows = await query<{ product_id: string }>(
		"select distinct product_id from sales where deleted_at is null",
	);
	expect(rows.map((row) => row.product_id)).toEqual([world.productId]);
});

Then(
	/^the sales sell (\d+) product$/,
	async ({ request: _request }, count: string) => {
		const rows = await query(
			"select distinct product_id from sales where deleted_at is null",
		);
		expect(rows).toHaveLength(Number(count));
	},
);

Then(
	/^the number of sales is (\d+)$/,
	async ({ request: _request }, count: string) => {
		expect(
			await query("select 1 from sales where deleted_at is null"),
		).toHaveLength(Number(count));
	},
);

Then(
	/^exactly (\d+) of them gets status (\d+)$/,
	async ({ request: _request }, count: string, status: string) => {
		expect(
			racers.filter((racer) => racer.status() === Number(status)),
		).toHaveLength(Number(count));
	},
);

Then(
	/^the others get status (\d+) with the error "([^"]+)"$/,
	async ({ request: _request }, status: string, error: string) => {
		const others = racers.filter((racer) => racer.status() !== 201);
		expect(others.length).toBeGreaterThan(0);
		for (const other of others) {
			expect(other.status()).toBe(Number(status));
			expect((await other.json()).errorCode).toBe(error);
		}
	},
);
