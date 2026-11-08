// The step bodies of the queue features (joining, admission, reserving, purchase, degraded service, recovery, caching,
// streaming and rate limits). Each layer hands a feature a ShopLayer: its world, the moment sales are timed from, and how
// a hold's end is checked. The bodies here run the same at both layers; the layer decides what they touch.
import { expect } from "vitest";
import type { ShopScenario } from "./queue-scenario.js";
import { type ReplyHolder, responseOf } from "./response.js";
import { relativeTime } from "./time.js";

// What a queue feature needs from its layer: a fresh scenario, the moment sales are timed from, and the check on a hold's
// end, which is exact in memory and within a tolerance over the real clock.
export type ShopLayer = {
	newWorld: () => ShopScenario;
	now: Date;
	expectHoldEndsIn: (endsAt: number, seconds: number) => void;
};

// The sale most queue scenarios start from: stock 10, nothing sold, open from an hour ago to an hour from now.
export const OPEN_SALE =
	"a sale with stock 10 and 0 sold that opens 1 hour ago and closes in 1 hour";

// Adds a sale to the scenario, open from an hour ago until an hour from `now`, with the stock and the sold count given.
export async function openSale(
	world: ShopScenario,
	now: Date,
	sale: { stock: number; sold: number },
): Promise<void> {
	await world.addSale({
		stock: sale.stock,
		sold: sale.sold,
		startsAt: relativeTime("1 hour ago", now),
		endsAt: relativeTime("in 1 hour", now),
	});
}

// "{string} joins the queue" and "{string} has joined the queue".
export function joinUser(world: ShopScenario) {
	return async (_ctx: unknown, user: string) => {
		await world.join(user);
	};
}

// "{string} has been admitted": the shopper joins and is let in at once.
export function admitUser(world: ShopScenario) {
	return async (_ctx: unknown, user: string) => {
		await world.admitted(user);
	};
}

// "{string} reserves an item" and "{string} has reserved an item".
export function reserveUser(world: ShopScenario) {
	return async (_ctx: unknown, user: string) => {
		await world.reserve(user);
	};
}

// "{string} confirms the purchase" and "{string} has confirmed the purchase".
export function confirmUser(world: ShopScenario) {
	return async (_ctx: unknown, user: string) => {
		await world.confirm(user);
	};
}

// "{int} seconds pass": the clock moves on, and any timer that is due fires.
export function secondsPass(world: ShopScenario) {
	return async (_ctx: unknown, seconds: number) => {
		await world.advance(seconds);
	};
}

// "the hold time of the sale is {int} second": the sale's hold lasts that long.
export function holdSecondsIs(world: ShopScenario) {
	return async (_ctx: unknown, seconds: number) => {
		await world.setHoldSeconds(seconds);
	};
}

// "{int} items remain": the sale, read through its public view, has that many left.
export function itemsRemain(world: ShopScenario) {
	return async (_ctx: unknown, remaining: number) => {
		expect((await world.saleView()).remaining).toBe(remaining);
	};
}

// "the hold ends in {int} seconds": the reply's hold ends that long after the moment the layer times from.
export function holdEndsIn(world: ReplyHolder, layer: ShopLayer) {
	return (_ctx: unknown, seconds: number) => {
		const ends = new Date(responseOf(world).json().expiresAt).getTime();
		layer.expectHoldEndsIn(ends, seconds);
	};
}

// "the limit is {int} requests per user in each {int} seconds": the per-user limit of the rate limiter is set.
export function userLimitIs(world: ShopScenario) {
	return async (_ctx: unknown, requests: number, seconds: number) => {
		await world.setUserLimit(requests, seconds);
	};
}

// "the reservation is a new one, not the one {string} had before": the reply holds a hold of its own.
export function newHoldGiven(world: ShopScenario) {
	return (_ctx: unknown, user: string) => {
		const { reservationId } = responseOf(world).json();
		expect(reservationId).toMatch(/^[0-9a-f-]{36}$/);
		expect(reservationId).not.toBe(world.holds.get(user)?.reservationId);
	};
}

// "the hold {string} had before is kept as a row marked deleted by {string}": the old hold was not overwritten.
export function oldHoldKept(world: ShopScenario) {
	return async (_ctx: unknown, user: string, by: string) => {
		const before = world.holds.get(user)?.reservationId;
		const rows = await world.holdRows();
		expect(rows.find((row) => row.reservationId === before)).toEqual({
			user,
			reservationId: before,
			deletedBy: by,
			counts: false,
		});
	};
}

// "{string} has one hold that counts, the new one": the shopper's only row not marked deleted is the hold just given.
export function oneHoldCounts(world: ShopScenario) {
	return async (_ctx: unknown, user: string) => {
		const rows = await world.holdRows();
		expect(
			rows.filter((row) => row.user === user && row.deletedBy === undefined),
		).toEqual([
			{
				user,
				reservationId: responseOf(world).json().reservationId,
				deletedBy: undefined,
				counts: true,
			},
		]);
	};
}
