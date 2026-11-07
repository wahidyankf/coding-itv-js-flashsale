import { expect } from "@playwright/test";
import { createBdd } from "playwright-bdd";
import { confirm } from "./purchase.steps.js";
import { join } from "./queue.steps.js";
import { reserve, waitUntilAdmitted } from "./reservation.steps.js";
import { bodyOf, routes, send } from "./support/api.js";
import { createSale, operatorHeaders } from "./support/operator.js";
import { currentResponse, setResponse } from "./support/response.js";
import { world } from "./support/world.js";

const { Given, When, Then } = createBdd();

const MINUTE_MS = 60_000;

function windowOf(startsInMinutes: number, minutes: number) {
	const startsAt = new Date(Date.now() + startsInMinutes * MINUTE_MS);
	return {
		startsAt,
		endsAt: new Date(startsAt.getTime() + minutes * MINUTE_MS),
	};
}

Given(
	/^a sale was created with stock (\d+), opened (\d+) minutes ago for (\d+) minutes$/,
	async ({ request }, stock: string, ago: string, minutes: string) => {
		world.saleId = await createSale(request, {
			stock: Number(stock),
			...windowOf(-Number(ago), Number(minutes)),
		});
	},
);

Given(
	/^another sale was created with stock (\d+), opening in (\d+) minutes for (\d+) minutes$/,
	async ({ request }, stock: string, startsIn: string, minutes: string) => {
		world.saleId = await createSale(request, {
			stock: Number(stock),
			...windowOf(Number(startsIn), Number(minutes)),
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

When(
	/^the operator (changes|moves|removes|lists) (.+?), (?:using the token "([^"]+)"|without a token)$/,
	async (
		{ request },
		verb: string,
		what: string,
		token: string | null | undefined,
	) => {
		const headers = token ? operatorHeaders(token) : {};
		const saleId = world.saleId ?? "";
		const phrase = `${verb} ${what}`;
		const change =
			/^changes that sale to stock (\d+)(?: and a hold time of (\d+) seconds)?$/.exec(
				phrase,
			);
		const move =
			/^moves that sale to open in (\d+) minutes for (\d+) minutes$/.exec(
				phrase,
			);
		if (change) {
			setResponse(
				await send(request, routes.updateSale, {
					params: { saleId },
					headers,
					body: {
						stock: Number(change[1]),
						...(change[2] === undefined
							? {}
							: { holdSeconds: Number(change[2]) }),
					},
				}),
			);
		} else if (move) {
			const { startsAt, endsAt } = windowOf(Number(move[1]), Number(move[2]));
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
			throw new Error(`the operator cannot ${phrase}`);
		}
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
			await send(request, routes.listSales, { headers: operatorHeaders() }),
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
