// Steps for creating a sale through the operator's route (`POST /admin/sales`): who may create one, the sale it makes, the
// product it sells, the races between operators, and the rows the database keeps. Binds sale/admin.feature and
// sale/operating.feature (its creating steps; the other operator steps are in operating.steps.ts).

import type { APIRequestContext, APIResponse } from "@playwright/test";
import { expect } from "@playwright/test";
import { createBdd } from "playwright-bdd";
import { bodyOf, givenFields, routes, send } from "./support/api.js";
import { operatorCookie, shopperCookie } from "./support/auth.js";
import { ensureDatabase, query, SYSTEM_USER } from "./support/database.js";
import { type Sender, senderHeaders } from "./support/operator.js";
import { currentResponse, setResponse } from "./support/response.js";
import { windowFromNow } from "./support/time.js";
import { world } from "./support/world.js";

const { Given, When, Then } = createBdd();

// The responses of operators who created at the same moment.
let racers: APIResponse[] = [];

// The numbers of a sale as the Gherkin writes them: its stock, and when it opens and closes, in minutes from now.
function saleOf(stock: string, startsIn: string, minutes: string) {
	return {
		stock: Number(stock),
		startsIn: Number(startsIn),
		minutes: Number(minutes),
	};
}

// The request that creates a sale, sent by `sender`. The sale opens `startsIn` minutes from now and lasts `minutes`.
// A request from nobody has no login to set the database up first, so the database is set up here too.
async function create(
	request: APIRequestContext,
	sale: {
		stock: number;
		startsIn: number;
		minutes: number;
		sender: Sender;
		productId?: string | undefined;
	},
): Promise<APIResponse> {
	await ensureDatabase();
	const { startsAt, endsAt } = windowFromNow(sale.startsIn, sale.minutes);
	return send(request, routes.createSale, {
		headers: await senderHeaders(request, sale.sender),
		body: givenFields({
			stock: sale.stock,
			startsAt: startsAt.toISOString(),
			endsAt: endsAt.toISOString(),
			productId: sale.productId,
		}),
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
		const made = await create(request, {
			...saleOf(stock, startsIn, minutes),
			sender: "operator",
			productId: world.productId,
		});
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

When(
	/^the operator creates a sale with stock (\d+), opening in (\d+) minutes for (\d+) minutes$/,
	async ({ request }, stock: string, startsIn: string, minutes: string) => {
		setResponse(
			await create(request, {
				...saleOf(stock, startsIn, minutes),
				sender: "operator",
			}),
		);
	},
);

When(
	/^the shopper creates a sale with stock (\d+), opening in (\d+) minutes for (\d+) minutes$/,
	async ({ request }, stock: string, startsIn: string, minutes: string) => {
		setResponse(
			await create(request, {
				...saleOf(stock, startsIn, minutes),
				sender: "shopper",
			}),
		);
	},
);

When(
	/^someone who is not logged in creates a sale with stock (\d+), opening in (\d+) minutes for (\d+) minutes$/,
	async ({ request }, stock: string, startsIn: string, minutes: string) => {
		setResponse(
			await create(request, {
				...saleOf(stock, startsIn, minutes),
				sender: "nobody",
			}),
		);
	},
);

When(
	/^the operator creates a sale of that product with stock (\d+), opening in (\d+) minutes for (\d+) minutes$/,
	async ({ request }, stock: string, startsIn: string, minutes: string) => {
		setResponse(
			await create(request, {
				...saleOf(stock, startsIn, minutes),
				sender: "operator",
				productId: world.productId,
			}),
		);
	},
);

When(
	/^the operator creates a sale of a product that does not exist with stock (\d+), opening in (\d+) minutes for (\d+) minutes$/,
	async ({ request }, stock: string, startsIn: string, minutes: string) => {
		setResponse(
			await create(request, {
				...saleOf(stock, startsIn, minutes),
				sender: "operator",
				productId: "00000000-0000-4000-8000-000000000000",
			}),
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
				create(request, {
					...saleOf(stock, startsIn, minutes),
					sender: "operator",
				}),
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
