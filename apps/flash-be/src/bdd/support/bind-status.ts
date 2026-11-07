// The steps of specs/apps/flash/be/behaviours/sale/status.feature, as both layers bind them. A layer adds sales to its store
// and the steps read the app's replies over it. A sale's window is a phrase, read against the layer's own clock. The titles
// stay in the layer's test file, where the behaviour checker reads them.
import { expect } from "vitest";
import { type ReplyBox, type Response, responseOf } from "./response.js";
import {
	errorIs,
	type OutlineBinder,
	type ScenarioBinder,
	statusIs,
} from "./steps.js";

// The fields a scenario sets for a sale. Only the fields the scenario states are given; the layer fills in the rest.
export type NewSale = {
	name?: string;
	stock?: number;
	sold?: number;
	opens: string;
	closes: string;
};

// The store the scenario adds sales to, and the app that reads it.
export type SaleWorld = {
	// Adds a sale to the store and returns its id.
	addSale: (sale: NewSale) => Promise<string>;
	// "no sale exists": empties the store.
	noSales: () => Promise<void>;
	// A request to the app over the store.
	get: (url: string) => Promise<Response>;
};

const NAMED_SALE = "a sale named {string} that opens {any} and closes {any}";

// Adds a named sale and keeps its id, so a later step can read the sale back by its name.
function namedSale(world: SaleWorld, ids: Map<string, string>) {
	return async (_ctx: unknown, name: string, opens: string, closes: string) => {
		ids.set(name, await world.addSale({ name, opens, closes }));
	};
}

// The reply to GET /sales/current, kept where the steps read it.
function askCurrent(world: SaleWorld, last: ReplyBox) {
	return async () => {
		last.response = await world.get("/sales/current");
	};
}

function reportsStatus(newWorld: () => SaleWorld): OutlineBinder {
	return ({ Given, When, Then, And }, examples) => {
		const world = newWorld();
		const last: ReplyBox = { response: undefined };
		let saleId: string;

		Given(
			"a sale with stock <stock> and <sold> sold that opens <opens> and closes <closes>",
			async () => {
				saleId = await world.addSale({
					stock: Number(examples.stock),
					sold: Number(examples.sold),
					opens: String(examples.opens),
					closes: String(examples.closes),
				});
			},
		);
		When("a client asks for that sale", async () => {
			last.response = await world.get(`/sales/${saleId}`);
		});
		Then("the response status is {int}", statusIs(last));
		And('the sale status is "<status>"', () => {
			expect(responseOf(last).json().status).toBe(examples.status);
		});
		And("<remaining> items remain", () => {
			expect(responseOf(last).json().remaining).toBe(
				Number(examples.remaining),
			);
		});
	};
}

// Two sales are added, and the current sale is the one the scenario names: the running one, or else the next to open.
function currentSale(newWorld: () => SaleWorld): ScenarioBinder {
	return ({ Given, And, When, Then }) => {
		const world = newWorld();
		const ids = new Map<string, string>();
		const last: ReplyBox = { response: undefined };

		Given(NAMED_SALE, namedSale(world, ids));
		And(NAMED_SALE, namedSale(world, ids));
		When("a client asks for the current sale", askCurrent(world, last));
		Then("the response status is {int}", statusIs(last));
		And("the sale name is {string}", (_ctx, name: string) => {
			expect(responseOf(last).json().name).toBe(name);
		});
	};
}

// A sale that is over is not the current sale, but its status is still read by its id.
function overKeepsId(newWorld: () => SaleWorld): ScenarioBinder {
	return ({ Given, When, Then, And }) => {
		const world = newWorld();
		const ids = new Map<string, string>();
		const last: ReplyBox = { response: undefined };

		Given(NAMED_SALE, namedSale(world, ids));
		When("a client asks for the current sale", askCurrent(world, last));
		Then("the response status is {int}", statusIs(last));
		And("the error is {string}", errorIs(last));
		And(
			"the sale named {string} has the status {string} when read by its id",
			async (_ctx, name: string, status: string) => {
				const read = await world.get(`/sales/${ids.get(name)}`);
				expect(read.json().status).toBe(status);
			},
		);
	};
}

function noCurrent(newWorld: () => SaleWorld): ScenarioBinder {
	return ({ Given, When, Then, And }) => {
		const world = newWorld();
		const last: ReplyBox = { response: undefined };

		Given("no sale exists", () => world.noSales());
		When("a client asks for the current sale", askCurrent(world, last));
		Then("the response status is {int}", statusIs(last));
		And("the error is {string}", errorIs(last));
	};
}

function unknownSale(newWorld: () => SaleWorld): OutlineBinder {
	return ({ Given, When, Then, And }, examples) => {
		const world = newWorld();
		const last: ReplyBox = { response: undefined };

		Given("no sale exists", () => world.noSales());
		When('a client asks for the sale with id "<id>"', async () => {
			last.response = await world.get(`/sales/${examples.id}`);
		});
		Then("the response status is {int}", statusIs(last));
		And("the error is {string}", errorIs(last));
	};
}

// The steps of each scenario in the status feature, by the scenario's name in the feature's own words.
export function bindSaleStatus(newWorld: () => SaleWorld) {
	return {
		reportsStatus: reportsStatus(newWorld),
		currentSale: currentSale(newWorld),
		overKeepsId: overKeepsId(newWorld),
		noCurrent: noCurrent(newWorld),
		unknownSale: unknownSale(newWorld),
	};
}
