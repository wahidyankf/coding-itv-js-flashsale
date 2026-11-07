// The steps of specs/apps/flash/be/behaviours/sale/admin.feature (creating), as both layers bind them. Each scenario gets the
// operator world its layer makes; the titles stay in the layer's test file, where the behaviour checker reads them.
import { randomUUID } from "node:crypto";
import { expect } from "vitest";
import type { OperatorWorld } from "./operating.js";
import {
	openingSale,
	operatorLoggedIn,
	SALE_OPENING,
	salesCountIs,
} from "./operator-steps.js";
import { type ReplyBox, type Response, responseOf } from "./response.js";
import {
	errorIs,
	type OutlineBinder,
	type ScenarioBinder,
	statusIs,
} from "./steps.js";

// The window of a sale an operator creates, in the words the scenarios use for it.
const START_OF = "opening in {int} minutes for {int} minutes";

function createsSale(newWorld: () => OperatorWorld): ScenarioBinder {
	return ({ Given, When, Then, And }) => {
		const world = newWorld();
		const last: ReplyBox = { response: undefined };

		Given("an operator is logged in", operatorLoggedIn(world));

		When(
			`the operator creates a sale with stock {int}, ${START_OF}`,
			async (_ctx, stock: number, startsIn: number, minutes: number) => {
				last.response = await world.createSale(stock, startsIn, minutes);
			},
		);

		Then("the response status is {int}", statusIs(last));

		And(
			"the new sale is {string} with {int} items remaining",
			(_ctx, status: string, remaining: number) => {
				expect(responseOf(last).json()).toMatchObject({ status, remaining });
			},
		);

		And("the current sale is the new sale", async () => {
			expect((await world.readCurrentSale()).json().id).toBe(
				responseOf(last).json().id,
			);
		});
	};
}

function refusesAnonymous(newWorld: () => OperatorWorld): ScenarioBinder {
	return ({ When, Then, And }) => {
		const world = newWorld();
		const last: ReplyBox = { response: undefined };

		When(
			`someone who is not logged in creates a sale with stock {int}, ${START_OF}`,
			async (_ctx, stock: number, startsIn: number, minutes: number) => {
				last.response = await world.createSale(
					stock,
					startsIn,
					minutes,
					"nobody",
				);
			},
		);

		Then("the response status is {int}", statusIs(last));

		And("the error is {string}", errorIs(last));

		And("the number of sales is {int}", salesCountIs(world));
	};
}

function shopperRefused(newWorld: () => OperatorWorld): ScenarioBinder {
	return ({ Given, When, Then, And }) => {
		const world = newWorld();
		const last: ReplyBox = { response: undefined };

		Given("a shopper is logged in", () => world.loginShopper("ana"));

		When(
			`the shopper creates a sale with stock {int}, ${START_OF}`,
			async (_ctx, stock: number, startsIn: number, minutes: number) => {
				last.response = await world.createSale(
					stock,
					startsIn,
					minutes,
					"shopper",
				);
			},
		);

		Then("the response status is {int}", statusIs(last));

		And("the error is {string}", errorIs(last));

		And("the number of sales is {int}", salesCountIs(world));
	};
}

function refusesUnworkable(newWorld: () => OperatorWorld): OutlineBinder {
	return ({ Given, When, Then, And }, examples) => {
		const world = newWorld();
		const last: ReplyBox = { response: undefined };

		Given("an operator is logged in", operatorLoggedIn(world));

		When(
			"the operator creates a sale with stock <stock>, opening in 10 minutes for <duration> minutes",
			async () => {
				last.response = await world.createSale(
					Number(examples.stock),
					10,
					Number(examples.duration),
				);
			},
		);

		Then("the response status is {int}", statusIs(last));

		And("the error is {string}", errorIs(last));

		And("the number of sales is {int}", salesCountIs(world));
	};
}

function refusesOverlap(newWorld: () => OperatorWorld): ScenarioBinder {
	return ({ Given, And, When, Then }) => {
		const world = newWorld();
		const last: ReplyBox = { response: undefined };

		Given("an operator is logged in", operatorLoggedIn(world));

		And(SALE_OPENING, openingSale(world));

		When(
			`the operator creates a sale with stock {int}, ${START_OF}`,
			async (_ctx, stock: number, startsIn: number, minutes: number) => {
				last.response = await world.createSale(stock, startsIn, minutes);
			},
		);

		Then("the response status is {int}", statusIs(last));

		And("the error is {string}", errorIs(last));

		And("the number of sales is {int}", salesCountIs(world));
	};
}

function acceptsAfterClose(newWorld: () => OperatorWorld): ScenarioBinder {
	return ({ Given, And, When, Then }) => {
		const world = newWorld();
		const last: ReplyBox = { response: undefined };

		Given("an operator is logged in", operatorLoggedIn(world));

		And(SALE_OPENING, openingSale(world));

		When(
			`the operator creates a sale with stock {int}, ${START_OF}`,
			async (_ctx, stock: number, startsIn: number, minutes: number) => {
				last.response = await world.createSale(stock, startsIn, minutes);
			},
		);

		Then("the response status is {int}", statusIs(last));

		And("the number of sales is {int}", salesCountIs(world));
	};
}

function oneSaleForSameWindow(newWorld: () => OperatorWorld): ScenarioBinder {
	return ({ Given, When, Then, And }) => {
		const world = newWorld();
		let responses: Response[] = [];

		Given("an operator is logged in", operatorLoggedIn(world));

		When(
			`{int} operators create a sale with stock {int}, ${START_OF}, at the same moment`,
			async (
				_ctx,
				operators: number,
				stock: number,
				startsIn: number,
				minutes: number,
			) => {
				responses = await Promise.all(
					Array.from({ length: operators }, () =>
						world.createSale(stock, startsIn, minutes),
					),
				);
			},
		);

		Then(
			"exactly {int} of them gets status {int}",
			(_ctx, count: number, status: number) => {
				expect(responses.filter((r) => r.statusCode === status)).toHaveLength(
					count,
				);
			},
		);

		And(
			"the others get status {int} with the error {string}",
			(_ctx, status: number, error: string) => {
				const others = responses.filter((r) => r.statusCode !== 201);
				expect(others.length).toBeGreaterThan(0);
				for (const other of others) {
					expect(other.statusCode).toBe(status);
					expect(other.json().errorCode).toBe(error);
				}
			},
		);

		And("the number of sales is {int}", salesCountIs(world));
	};
}

function createsForProduct(newWorld: () => OperatorWorld): ScenarioBinder {
	return ({ Given, And, When, Then }) => {
		const world = newWorld();
		const last: ReplyBox = { response: undefined };

		Given("an operator is logged in", operatorLoggedIn(world));

		And("a product named {string} exists", async (_ctx, name: string) => {
			await world.makeProduct(name);
		});

		When(
			`the operator creates a sale of that product with stock {int}, ${START_OF}`,
			async (_ctx, stock: number, startsIn: number, minutes: number) => {
				last.response = await world.createSale(stock, startsIn, minutes);
			},
		);

		Then("the response status is {int}", statusIs(last));

		And("the new sale sells that product", async () => {
			expect(responseOf(last).json().productId).toBe(world.lastProductId);
			expect(await world.productsOfSales()).toEqual([world.lastProductId]);
		});
	};
}

function refusesUnknownProduct(newWorld: () => OperatorWorld): ScenarioBinder {
	return ({ Given, When, Then, And }) => {
		const world = newWorld();
		const last: ReplyBox = { response: undefined };

		Given("an operator is logged in", operatorLoggedIn(world));

		When(
			`the operator creates a sale of a product that does not exist with stock {int}, ${START_OF}`,
			async (_ctx, stock: number, startsIn: number, minutes: number) => {
				last.response = await world.createSaleFor(
					stock,
					startsIn,
					minutes,
					randomUUID(),
				);
			},
		);

		Then("the response status is {int}", statusIs(last));

		And("the error is {string}", errorIs(last));

		And("the number of sales is {int}", salesCountIs(world));
	};
}

function sharesProduct(newWorld: () => OperatorWorld): ScenarioBinder {
	return ({ Given, And, When, Then }) => {
		const world = newWorld();
		const last: ReplyBox = { response: undefined };

		Given("an operator is logged in", operatorLoggedIn(world));

		And(SALE_OPENING, openingSale(world));

		When(
			`the operator creates a sale with stock {int}, ${START_OF}`,
			async (_ctx, stock: number, startsIn: number, minutes: number) => {
				last.response = await world.createSale(stock, startsIn, minutes);
			},
		);

		Then("the response status is {int}", statusIs(last));

		And("the number of sales is {int}", salesCountIs(world));

		And("the sales sell {int} product", async (_ctx, products: number) => {
			expect(await world.productsOfSales()).toHaveLength(products);
		});
	};
}

// The steps of each scenario in the creating feature, by the scenario's name in the feature's own words.
export function bindAdminCreating(newWorld: () => OperatorWorld) {
	return {
		createsSale: createsSale(newWorld),
		refusesAnonymous: refusesAnonymous(newWorld),
		shopperRefused: shopperRefused(newWorld),
		refusesUnworkable: refusesUnworkable(newWorld),
		refusesOverlap: refusesOverlap(newWorld),
		acceptsAfterClose: acceptsAfterClose(newWorld),
		oneSaleForSameWindow: oneSaleForSameWindow(newWorld),
		createsForProduct: createsForProduct(newWorld),
		refusesUnknownProduct: refusesUnknownProduct(newWorld),
		sharesProduct: sharesProduct(newWorld),
	};
}
