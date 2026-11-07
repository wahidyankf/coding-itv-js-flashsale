// The steps the operator features share: the operator's login, the sales a scenario makes before the change, the stock a
// sale has, and how many sales there are. Both operator features bind them the same way, at either layer, over the
// operator world the layer makes.
import { expect } from "vitest";
import type { OperatorWorld } from "./operating.js";

// The texts the operator features share. Each one is bound with the same body wherever it appears.
export const SALE_OPENING =
	"a sale was created with stock {int}, opening in {int} minutes for {int} minutes";
// A sale that opened some minutes ago, as the operator features word it.
export const SALE_OPENED =
	"a sale was created with stock {int}, opened {int} minutes ago for {int} minutes";
// A second sale, scheduled beside the first, as the operator features word it.
export const ANOTHER_SALE =
	"another sale was created with stock {int}, opening in {int} minutes for {int} minutes";
// The stock left on the sale a scenario is about, as the operator features word it.
export const STOCK_LEFT = "the sale has stock {int} with {int} items remaining";

// "an operator is logged in": the operator's cookie is set, and the account is made the first time.
export function operatorLoggedIn(world: OperatorWorld) {
	return () => world.loginOperator();
}

// A sale the operator opens in `startsIn` minutes from now, for `minutes` minutes. The API must accept it.
export function openingSale(world: OperatorWorld) {
	return async (
		_ctx: unknown,
		stock: number,
		startsIn: number,
		minutes: number,
	) => {
		expect((await world.createSale(stock, startsIn, minutes)).statusCode).toBe(
			201,
		);
	};
}

// A sale that opened `ago` minutes before now, for `minutes` minutes. The API must accept it.
export function openedSale(world: OperatorWorld) {
	return async (_ctx: unknown, stock: number, ago: number, minutes: number) => {
		expect((await world.createSale(stock, -ago, minutes)).statusCode).toBe(201);
	};
}

// "the sale has stock {int} with {int} items remaining": the public read of the sale shows both numbers.
export function stockLeft(world: OperatorWorld) {
	return async (_ctx: unknown, stock: number, remaining: number) => {
		expect((await world.readSale()).json()).toMatchObject({ stock, remaining });
	};
}

// "the number of sales is {int}": the sales that were not removed, as the store counts them.
export function salesCountIs(world: OperatorWorld) {
	return async (_ctx: unknown, count: number) => {
		expect(await world.salesCount()).toBe(count);
	};
}
