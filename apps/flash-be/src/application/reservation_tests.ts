// The reservation use case, against fake stores: the answers of the gate, the rebuild from Postgres, and the replies.
import { randomUUID } from "node:crypto";
import { Err, Ok, type Result } from "@flash/typekit";
import { describe, expect, it } from "vitest";
import { queueWorld } from "../bdd/support/queue-world.js";
import { relativeTime } from "../bdd/support/time.js";
import type { GateAnswer } from "../domain/reservation.js";
import { createGuardedGate } from "./guarded-gate.js";
import type { HoldGate } from "./ports/hold-gate.js";
import type { UnreadableReply } from "./ports/reply.js";
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

// A gate whose answers are given in order. Each answer is a value of the gate port, so an unreadable one is a Result.
function gateWith(
	answers: Array<Result<GateAnswer, UnreadableReply>>,
	overrides: Partial<HoldGate> = {},
) {
	const queue = [...answers];
	const calls = { restore: 0, lock: 0 };
	const gate: HoldGate = {
		reserve: async () => queue.shift() ?? new Ok({ kind: "not_ready" }),
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

// The gate's answers as plain answers, which is the usual case in these tests.
const answers = (...kinds: GateAnswer[]) => kinds.map((kind) => new Ok(kind));

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
		newId: randomUUID,
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
		const { gate } = gateWith(answers({ kind: "purchased" }));
		expect(await reserveWith(gate)).toEqual(new Err("already_purchased"));
	});

	it("rebuilds once and asks the gate again", async () => {
		const { gate, calls } = gateWith(
			answers({ kind: "not_ready" }, { kind: "sold_out" }),
		);
		expect(await reserveWith(gate)).toEqual(new Err("sold_out"));
		expect(calls).toEqual({ restore: 1, lock: 1 });
	});

	it("answers unavailable when the state is still not ready after a rebuild", async () => {
		const { gate } = gateWith(
			answers({ kind: "not_ready" }, { kind: "not_ready" }),
		);
		expect(await reserveWith(gate)).toEqual(new Err("unavailable"));
	});

	it("waits for another instance that is rebuilding, then goes on", async () => {
		let polls = 0;
		const { gate, calls } = gateWith(
			answers({ kind: "not_ready" }, { kind: "sold_out" }),
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
		const { gate } = gateWith(answers({ kind: "not_ready" }), {
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
		const { gate } = gateWith(answers({ kind: "not_ready" }), {
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
		const { gate } = gateWith(answers({ kind: "not_ready" }), {
			lockRebuild: async () => false,
		});
		expect(await reserveWith(gate)).toEqual(new Err("unavailable"));
	});

	it("goes on when another instance finished the rebuild just before", async () => {
		const { gate, calls } = gateWith(
			answers({ kind: "not_ready" }, { kind: "sold_out" }),
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
				return new Ok({ kind: "sold_out" });
			},
			isReady: async () => true,
		});
		expect(await reserveWith(gate)).toEqual(new Err("sold_out"));
		expect(calls).toBe(2);
	});

	// The rebuild lock is taken under one owner token, and released only with that token: the token comes from the
	// injected id maker, so a test can read it back.
	it("takes the rebuild lock under one owner token and releases it with that token", async () => {
		const owners: string[] = [];
		const released: string[] = [];
		const { gate } = gateWith(
			answers({ kind: "not_ready" }, { kind: "sold_out" }),
			{
				lockRebuild: async (_saleId, _ms, owner) => {
					owners.push(owner);
					return true;
				},
				unlockRebuild: async (_saleId, owner) => {
					released.push(owner);
				},
			},
		);
		expect(await reserveWith(gate)).toEqual(new Err("sold_out"));
		expect(owners).toHaveLength(1);
		expect(owners[0]).not.toBe("");
		expect(released).toEqual(owners);
	});

	it("keeps the save's failure when the item cannot be given back either", async () => {
		const { gate } = gateWith(
			answers({
				kind: "reserved",
				reservationId: randomUUID(),
				expiresAt: NOW,
			}),
			{
				release: async () => {
					throw new Error("redis is down");
				},
			},
		);
		const { world, saleId, ticket } = await admittedAna();
		world.repository.broken = true;
		const service = createReservationService({
			gate: createGuardedGate(gate),
			repository: world.repository,
			sales: world.saleService,
			queue: world.queue,
			clock,
			newId: randomUUID,
			options: { rebuildWaitMs: 100, wait: async () => {}, random: () => 0.5 },
		});
		await expect(service.reserve(saleId, "ana", ticket)).rejects.toThrow(
			"postgres is unreachable",
		);
	});

	it("answers sale_not_found when the sale was removed while the request ran", async () => {
		const { gate } = gateWith([], {
			reserve: async () => {
				throw new Error("redis is down");
			},
		});
		const { world, saleId, ticket } = await admittedAna();
		const service = createReservationService({
			gate: createGuardedGate(gate),
			repository: {
				...world.repository,
				reserveWithoutGate: async () => ({ kind: "sale_not_found" }),
			},
			sales: world.saleService,
			queue: world.queue,
			clock,
			newId: randomUUID,
			options: { rebuildWaitMs: 100, wait: async () => {}, random: () => 0.5 },
		});
		expect(await service.reserve(saleId, "ana", ticket)).toEqual(
			new Err("sale_not_found"),
		);
	});

	// An answer that cannot be read is the gate being down: Postgres decides, as it does for a failed call.
	it("lets Postgres decide when the gate's answer cannot be read", async () => {
		const { gate } = gateWith([new Err("unreadable_reply")]);
		expect((await reserveWith(gate)).isOk()).toBe(true);
	});

	it("tells a shopper whose queue place was lost that they are not admitted", async () => {
		const { world, saleId, ticket } = await admittedAna();
		world.store.clear();
		expect(await world.reservations.reserve(saleId, "ana", ticket)).toEqual(
			new Err("not_admitted"),
		);
	});
});
