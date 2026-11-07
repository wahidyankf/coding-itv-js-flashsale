// Steps for the operator's sale routes once a sale exists: changing its stock and hold time, moving its window, removing it,
// and listing the sales. Each request is sent by the operator, a shopper or nobody, as the scenario names it. Binds
// sale/operating.feature. The routes that create a sale are in admin.steps.ts.

import type { APIRequestContext } from "@playwright/test";
import { expect } from "@playwright/test";
import { createBdd } from "playwright-bdd";
import { bodyOf, givenFields, routes, send } from "./support/api.js";
import { E2E_OPERATOR } from "./support/auth.js";
import { query } from "./support/database.js";
import {
	createSale,
	operatorHeaders,
	type Sender,
	senderHeaders,
} from "./support/operator.js";
import { currentResponse, setResponse } from "./support/response.js";
import {
	confirm,
	join,
	reserve,
	waitUntilAdmitted,
} from "./support/shoppers.js";
import { windowFromNow } from "./support/time.js";
import { world } from "./support/world.js";

const { Given, When, Then } = createBdd();

Given(
	/^a sale was created with stock (\d+), opened (\d+) minutes ago for (\d+) minutes$/,
	async ({ request }, stock: string, ago: string, minutes: string) => {
		world.saleId = await createSale(request, {
			stock: Number(stock),
			...windowFromNow(-Number(ago), Number(minutes)),
		});
	},
);

Given(
	/^another sale was created with stock (\d+), opening in (\d+) minutes for (\d+) minutes$/,
	async ({ request }, stock: string, startsIn: string, minutes: string) => {
		world.saleId = await createSale(request, {
			stock: Number(stock),
			...windowFromNow(Number(startsIn), Number(minutes)),
		});
	},
);

// A shopper goes through the routes: queue, hold, purchase.
Given("an item of that sale was bought", async ({ request }) => {
	await join(request, "ana");
	await waitUntilAdmitted(request, ["ana"]);
	await reserve(request, "ana");
	await confirm(request, "ana");
	expect(currentResponse().status()).toBe(201);
});

// One request of an operator, written the way the scenarios say it. `sender` is who sends it.
async function operate(
	request: APIRequestContext,
	sender: Sender,
	verb: string,
	what: string,
) {
	const headers = await senderHeaders(request, sender);
	const saleId = world.saleId ?? "";
	const phrase = `${verb} ${what}`;
	const change =
		/^changes that sale to stock (\d+)(?: and a hold time of (\d+) seconds)?$/.exec(
			phrase,
		);
	const move =
		/^moves that sale to open in (\d+) minutes for (\d+) minutes$/.exec(phrase);
	if (change) {
		setResponse(
			await send(request, routes.updateSale, {
				params: { saleId },
				headers,
				body: givenFields({
					stock: Number(change[1]),
					holdSeconds: change[2] === undefined ? undefined : Number(change[2]),
				}),
			}),
		);
	} else if (move) {
		const { startsAt, endsAt } = windowFromNow(
			Number(move[1]),
			Number(move[2]),
		);
		setResponse(
			await send(request, routes.updateSale, {
				params: { saleId },
				headers,
				body: {
					startsAt: startsAt.toISOString(),
					endsAt: endsAt.toISOString(),
				},
			}),
		);
	} else if (phrase === "removes that sale") {
		setResponse(
			await send(request, routes.removeSale, { params: { saleId }, headers }),
		);
	} else if (phrase === "lists the sales") {
		setResponse(await send(request, routes.listSales, { headers }));
	} else {
		throw new Error(`nobody can ${phrase}`);
	}
}

When(
	/^the operator (changes|moves|removes|lists) (.+)$/,
	async ({ request }, verb: string, what: string) => {
		await operate(request, "operator", verb, what);
	},
);

When(
	/^the shopper (changes|moves|removes|lists) (.+)$/,
	async ({ request }, verb: string, what: string) => {
		await operate(request, "shopper", verb, what);
	},
);

When(
	/^someone who is not logged in (changes|moves|removes|lists) (.+)$/,
	async ({ request }, verb: string, what: string) => {
		await operate(request, "nobody", verb, what);
	},
);

Then(
	/^the sale has stock (\d+) with (\d+) items remaining$/,
	async ({ request }, stock: string, remaining: string) => {
		const sale = await bodyOf(
			routes.sale,
			await send(request, routes.sale, {
				params: { saleId: world.saleId ?? "" },
			}),
		);
		expect(sale).toMatchObject({
			stock: Number(stock),
			remaining: Number(remaining),
		});
	},
);

Then(
	/^the operator sees a hold time of (\d+) seconds on that sale$/,
	async ({ request }, seconds: string) => {
		const listed = await bodyOf(
			routes.listSales,
			await send(request, routes.listSales, {
				headers: await operatorHeaders(request),
			}),
		);
		expect(
			listed?.sales.find((sale) => sale.id === world.saleId)?.holdSeconds,
		).toBe(Number(seconds));
	},
);

Then(
	/^the listed sales have the stocks (\d+) and (\d+), in that order$/,
	async ({ request: _request }, first: string, second: string) => {
		const stocks = (await currentResponse().json()).sales.map(
			(sale: { stock: number }) => sale.stock,
		);
		expect(stocks).toEqual([Number(first), Number(second)]);
	},
);

Then("that sale is not listed", async ({ request }) => {
	const listed = await bodyOf(
		routes.listSales,
		await send(request, routes.listSales, {
			headers: await operatorHeaders(request),
		}),
	);
	expect(listed?.sales.map((sale) => sale.id)).not.toContain(world.saleId);
});

Then(
	"that sale is kept and marked as deleted by the operator",
	async ({ request: _request }) => {
		const rows = await query<{ username: string }>(
			`select u.username from sales s join users u on u.id = s.deleted_by
			 where s.id = $1 and s.deleted_at is not null`,
			[world.saleId],
		);
		expect(rows.map((row) => row.username)).toEqual([E2E_OPERATOR]);
	},
);
