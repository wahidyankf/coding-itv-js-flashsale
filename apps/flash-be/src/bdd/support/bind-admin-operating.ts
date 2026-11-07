// The steps of specs/apps/flash/be/behaviours/sale/operating.feature, as both layers bind them. Each scenario gets the
// operator world its layer makes; the titles stay in the layer's test file, where the behaviour checker reads them.
import { expect } from "vitest";
import type { OperatorWorld } from "./operating.js";
import {
	ANOTHER_SALE,
	openedSale,
	openingSale,
	operatorLoggedIn,
	SALE_OPENED,
	SALE_OPENING,
	STOCK_LEFT,
	salesCountIs,
	stockLeft,
} from "./operator-steps.js";
import { type ReplyBox, responseOf } from "./response.js";
import {
	errorIs,
	type OutlineBinder,
	type ScenarioBinder,
	statusIs,
} from "./steps.js";

function changesNotStarted(newWorld: () => OperatorWorld): ScenarioBinder {
	return ({ Given, When, Then, And }) => {
		const world = newWorld();
		const last: ReplyBox = { response: undefined };

		Given("an operator is logged in", operatorLoggedIn(world));
		And(SALE_OPENING, openingSale(world));

		When(
			"the operator changes that sale to stock {int} and a hold time of {int} seconds",
			async (_ctx, stock: number, hold: number) => {
				last.response = await world.operate(
					`changes that sale to stock ${stock} and a hold time of ${hold} seconds`,
					"operator",
				);
			},
		);

		Then("the response status is {int}", statusIs(last));

		And(STOCK_LEFT, stockLeft(world));

		And(
			"the operator sees a hold time of {int} seconds on that sale",
			async (_ctx, seconds: number) => {
				const listed: Array<{ id: string; holdSeconds: number }> = (
					await world.listSales()
				).json().sales;
				expect(
					listed.find((sale) => sale.id === world.saleId)?.holdSeconds,
				).toBe(seconds);
			},
		);
	};
}

function growsStartedSale(newWorld: () => OperatorWorld): ScenarioBinder {
	return ({ Given, When, Then, And }) => {
		const world = newWorld();
		const last: ReplyBox = { response: undefined };

		Given("an operator is logged in", operatorLoggedIn(world));
		And(SALE_OPENED, openedSale(world));

		When(
			"the operator changes that sale to stock {int}",
			async (_ctx, stock: number) => {
				last.response = await world.operate(
					`changes that sale to stock ${stock}`,
					"operator",
				);
			},
		);

		Then("the response status is {int}", statusIs(last));

		And(STOCK_LEFT, stockLeft(world));
	};
}

function keepsStartOfStartedSale(newWorld: () => OperatorWorld): OutlineBinder {
	return ({ Given, When, Then, And }, examples) => {
		const world = newWorld();
		const last: ReplyBox = { response: undefined };

		Given("an operator is logged in", operatorLoggedIn(world));
		And(SALE_OPENED, openedSale(world));

		When("the operator <change>", async () => {
			last.response = await world.operate(String(examples.change), "operator");
		});

		Then("the response status is {int}", statusIs(last));

		And("the error is {string}", errorIs(last));

		And(STOCK_LEFT, stockLeft(world));
	};
}

function overStaysAsIs(newWorld: () => OperatorWorld): ScenarioBinder {
	return ({ Given, When, Then, And }) => {
		const world = newWorld();
		const last: ReplyBox = { response: undefined };

		Given("an operator is logged in", operatorLoggedIn(world));
		And(SALE_OPENED, openedSale(world));

		When(
			"the operator changes that sale to stock {int}",
			async (_ctx, stock: number) => {
				last.response = await world.operate(
					`changes that sale to stock ${stock}`,
					"operator",
				);
			},
		);

		Then("the response status is {int}", statusIs(last));

		And("the error is {string}", errorIs(last));
	};
}

function refusesOverlappingMove(newWorld: () => OperatorWorld): ScenarioBinder {
	return ({ Given, When, Then, And }) => {
		const world = newWorld();
		const last: ReplyBox = { response: undefined };

		Given("an operator is logged in", operatorLoggedIn(world));
		And(SALE_OPENING, openingSale(world));
		And(ANOTHER_SALE, openingSale(world));

		When(
			"the operator moves that sale to open in {int} minutes for {int} minutes",
			async (_ctx, startsIn: number, minutes: number) => {
				last.response = await world.operate(
					`moves that sale to open in ${startsIn} minutes for ${minutes} minutes`,
					"operator",
				);
			},
		);

		Then("the response status is {int}", statusIs(last));

		And("the error is {string}", errorIs(last));
	};
}

function refusesUnusableChange(newWorld: () => OperatorWorld): ScenarioBinder {
	return ({ Given, When, Then, And }) => {
		const world = newWorld();
		const last: ReplyBox = { response: undefined };

		Given("an operator is logged in", operatorLoggedIn(world));
		And(SALE_OPENING, openingSale(world));

		When(
			"the operator changes that sale to stock {int}",
			async (_ctx, stock: number) => {
				last.response = await world.operate(
					`changes that sale to stock ${stock}`,
					"operator",
				);
			},
		);

		Then("the response status is {int}", statusIs(last));

		And("the error is {string}", errorIs(last));

		And(STOCK_LEFT, stockLeft(world));
	};
}

function removesUnbought(newWorld: () => OperatorWorld): ScenarioBinder {
	return ({ Given, When, Then, And }) => {
		const world = newWorld();
		const last: ReplyBox = { response: undefined };

		Given("an operator is logged in", operatorLoggedIn(world));
		And(SALE_OPENING, openingSale(world));

		When("the operator removes that sale", async () => {
			last.response = await world.operate("removes that sale", "operator");
		});

		Then("the response status is {int}", statusIs(last));

		And("the number of sales is {int}", salesCountIs(world));
	};
}

function keepsRemovedRow(newWorld: () => OperatorWorld): ScenarioBinder {
	return ({ Given, When, Then, And }) => {
		const world = newWorld();
		const last: ReplyBox = { response: undefined };

		Given("an operator is logged in", operatorLoggedIn(world));
		And(SALE_OPENING, openingSale(world));

		When("the operator removes that sale", async () => {
			last.response = await world.operate("removes that sale", "operator");
		});

		Then("the response status is {int}", statusIs(last));

		And("that sale is not listed", async () => {
			const listed: Array<{ id: string }> = (await world.listSales()).json()
				.sales;
			expect(listed.map((sale) => sale.id)).not.toContain(world.saleId);
		});

		And("that sale is kept and marked as deleted by the operator", async () => {
			const operatorId = await world.operatorId();
			expect(operatorId).toBeDefined();
			expect(await world.deletedBy(world.saleId)).toBe(operatorId);
		});
	};
}

function refusesRemovalWithPurchase(
	newWorld: () => OperatorWorld,
): ScenarioBinder {
	return ({ Given, When, Then, And }) => {
		const world = newWorld();
		const last: ReplyBox = { response: undefined };

		Given("an operator is logged in", operatorLoggedIn(world));
		And(SALE_OPENED, openedSale(world));

		And("an item of that sale was bought", async () => {
			await world.buyItem();
		});

		When("the operator removes that sale", async () => {
			last.response = await world.operate("removes that sale", "operator");
		});

		Then("the response status is {int}", statusIs(last));

		And("the error is {string}", errorIs(last));

		And("the number of sales is {int}", salesCountIs(world));
	};
}

function listsNewestFirst(newWorld: () => OperatorWorld): ScenarioBinder {
	return ({ Given, When, Then, And }) => {
		const world = newWorld();
		const last: ReplyBox = { response: undefined };

		Given("an operator is logged in", operatorLoggedIn(world));
		And(SALE_OPENING, openingSale(world));
		And(ANOTHER_SALE, openingSale(world));

		When("the operator lists the sales", async () => {
			last.response = await world.operate("lists the sales", "operator");
		});

		Then("the response status is {int}", statusIs(last));

		And(
			"the listed sales have the stocks {int} and {int}, in that order",
			(_ctx, first: number, second: number) => {
				const stocks = responseOf(last)
					.json()
					.sales.map((sale: { stock: number }) => sale.stock);
				expect(stocks).toEqual([first, second]);
			},
		);
	};
}

function needsLoginOutline(newWorld: () => OperatorWorld): OutlineBinder {
	return ({ Given, When, Then, And }, examples) => {
		const world = newWorld();
		const last: ReplyBox = { response: undefined };

		Given("an operator is logged in", operatorLoggedIn(world));
		And(SALE_OPENING, openingSale(world));

		When("someone who is not logged in <request>", async () => {
			last.response = await world.operate(String(examples.request), "nobody");
		});

		Then("the response status is {int}", statusIs(last));

		And("the error is {string}", errorIs(last));

		And(STOCK_LEFT, stockLeft(world));
	};
}

function operatorsOnlyOutline(newWorld: () => OperatorWorld): OutlineBinder {
	return ({ Given, When, Then, And }, examples) => {
		const world = newWorld();
		const last: ReplyBox = { response: undefined };

		Given("an operator is logged in", operatorLoggedIn(world));
		And(SALE_OPENING, openingSale(world));
		And("a shopper is logged in", () => world.loginShopper("ana"));

		When("the shopper <request>", async () => {
			last.response = await world.operate(String(examples.request), "shopper");
		});

		Then("the response status is {int}", statusIs(last));

		And("the error is {string}", errorIs(last));

		And(STOCK_LEFT, stockLeft(world));
	};
}

// The steps of each scenario in the operating feature, by the scenario's name in the feature's own words.
export function bindAdminOperating(newWorld: () => OperatorWorld) {
	return {
		changesNotStarted: changesNotStarted(newWorld),
		growsStartedSale: growsStartedSale(newWorld),
		keepsStartOfStartedSale: keepsStartOfStartedSale(newWorld),
		overStaysAsIs: overStaysAsIs(newWorld),
		refusesOverlappingMove: refusesOverlappingMove(newWorld),
		refusesUnusableChange: refusesUnusableChange(newWorld),
		removesUnbought: removesUnbought(newWorld),
		keepsRemovedRow: keepsRemovedRow(newWorld),
		refusesRemovalWithPurchase: refusesRemovalWithPurchase(newWorld),
		listsNewestFirst: listsNewestFirst(newWorld),
		needsLoginOutline: needsLoginOutline(newWorld),
		operatorsOnlyOutline: operatorsOnlyOutline(newWorld),
	};
}
