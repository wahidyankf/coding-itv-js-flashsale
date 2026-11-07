// The reservation use case, against fake stores: the answers of the gate, the rebuild from Postgres, and the replies.
import { Err } from "@flash/typekit";
import { describe, expect, it } from "vitest";
import { queueWorld } from "../bdd/support/queue-world.js";
import { relativeTime } from "../bdd/support/time.js";
import type { GateAnswer } from "../domain/reservation.js";
import { createGuardedGate } from "./guarded-gate.js";
import type { HoldGate } from "./ports/hold-gate.js";
import {
	createReservationService,
	type ReservationOptions,
} from "./reservation-service.js";

// Paths that a scenario cannot reach with the in-memory gate: a gate that answers in a fixed way, and a rebuild
// that another instance is doing.
const NOW = new Date("2026-06-01T12:00:00Z");
const clock = () => NOW;

async function admittedAna() {
	const world = queueWorld(NOW);
	const saleId = await world.addSale({
		stock: 5,
		startsAt: relativeTime("1 hour ago", NOW),
		endsAt: relativeTime("in 1 hour", NOW),
	});
	await world.admitted("ana");
	const ticket = world.tickets.get("ana");
	return { world, saleId, ticket };
}

function gateWith(answers: GateAnswer[], overrides: Partial<HoldGate> = {}) {
	const queue = [...answers];
	const calls = { restore: 0, lock: 0 };
	const gate: HoldGate = {
		reserve: async () => queue.shift() ?? { kind: "not_ready" },
		invalidate: async () => {},
		release: async () => {},
		confirm: async () => {},
		isReady: async () => false,
		restore: async () => {
			calls.restore++;
		},
		lockRebuild: async () => {
			calls.lock++;
			return true;
		},
		unlockRebuild: async () => {},
		...overrides,
	};
	return { gate, calls };
}

async function reserveWith(
	gate: HoldGate,
	options: Partial<ReservationOptions> = {},
) {
	const guarded = createGuardedGate(gate);
	const { world, saleId, ticket } = await admittedAna();
	const service = createReservationService({
		gate: guarded,
		repository: world.repository,
		sales: world.saleService,
		queue: world.queue,
		clock,
		options: {
			rebuildWaitMs: 100,
			wait: async () => {},
			random: () => 0.5,
			...options,
		},
	});
	return service.reserve(saleId, "ana", ticket);
}

describe("the reservation service", () => {
	it("answers already_purchased when the gate knows the user bought", async () => {
		const { gate } = gateWith([{ kind: "purchased" }]);
		expect(await reserveWith(gate)).toEqual(new Err("already_purchased"));
	});

	it("rebuilds once and asks the gate again", async () => {
		const { gate, calls } = gateWith([
			{ kind: "not_ready" },
			{ kind: "sold_out" },
		]);
		expect(await reserveWith(gate)).toEqual(new Err("sold_out"));
		expect(calls).toEqual({ restore: 1, lock: 1 });
	});

	it("answers unavailable when the state is still not ready after a rebuild", async () => {
		const { gate } = gateWith([{ kind: "not_ready" }, { kind: "not_ready" }]);
		expect(await reserveWith(gate)).toEqual(new Err("unavailable"));
	});

	it("waits for another instance that is rebuilding, then goes on", async () => {
		let polls = 0;
		const { gate, calls } = gateWith(
			[{ kind: "not_ready" }, { kind: "sold_out" }],
			{
				lockRebuild: async () => false,
				isReady: async () => ++polls > 3,
			},
		);
		expect(await reserveWith(gate)).toEqual(new Err("sold_out"));
		expect(calls.restore).toBe(0);
	});

	// Decision 017: the wait doubles from 25 ms, capped at 500 ms, with full jitter (random() scales each wait).
	it("waits between polls with backoff, scaled by the random draw", async () => {
		const waits: number[] = [];
		const { gate } = gateWith([{ kind: "not_ready" }], {
			lockRebuild: async () => false,
		});
		expect(
			await reserveWith(gate, {
				rebuildWaitMs: 100,
				wait: async (ms) => {
					waits.push(ms);
				},
				random: () => 0.5,
			}),
		).toEqual(new Err("unavailable"));
		// The bounds are 25 ms then 50 ms; a draw of 0.5 takes half of each.
		expect(waits).toEqual([12.5, 25]);
	});

	it("never waits longer in all than the rebuild wait, even when every draw is at its top", async () => {
		const waits: number[] = [];
		const { gate } = gateWith([{ kind: "not_ready" }], {
			lockRebuild: async () => false,
		});
		await reserveWith(gate, {
			rebuildWaitMs: 3000,
			wait: async (ms) => {
				waits.push(ms);
			},
			random: () => 0.999,
		});
		// The bounds are 25, 50, 100, 200, 400, then 500 each: nine waits add up to 2775 ms, and a tenth would pass 3000.
		expect(waits).toHaveLength(9);
		expect(waits.reduce((total, ms) => total + ms, 0)).toBeLessThanOrEqual(
			3000,
		);
	});

	it("answers unavailable when the other rebuild never finishes", async () => {
		const { gate } = gateWith([{ kind: "not_ready" }], {
			lockRebuild: async () => false,
		});
		expect(await reserveWith(gate)).toEqual(new Err("unavailable"));
	});

	it("goes on when another instance finished the rebuild just before", async () => {
		const { gate, calls } = gateWith(
			[{ kind: "not_ready" }, { kind: "sold_out" }],
			{
				isReady: async () => true,
			},
		);
		expect(await reserveWith(gate)).toEqual(new Err("sold_out"));
		expect(calls.lock).toBe(0);
	});

	it("asks the gate again when Redis is ready again by the time Postgres has the lock", async () => {
		let calls = 0;
		const { gate } = gateWith([], {
			reserve: async () => {
				if (++calls === 1) throw new Error("redis is down");
				return { kind: "sold_out" };
			},
			isReady: async () => true,
		});
		expect(await reserveWith(gate)).toEqual(new Err("sold_out"));
		expect(calls).toBe(2);
	});

	it("tells a shopper whose queue place was lost that they are not admitted", async () => {
		const { world, saleId, ticket } = await admittedAna();
		world.store.clear();
		expect(await world.reservations.reserve(saleId, "ana", ticket)).toEqual(
			new Err("not_admitted"),
		);
	});
});
