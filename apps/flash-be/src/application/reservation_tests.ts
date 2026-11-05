import { describe, expect, it } from "vitest";
import { queueWorld } from "../bdd/support/queue-world.js";
import { relativeTime } from "../bdd/support/time.js";
import type { GateAnswer } from "../domain/reservation.js";
import { createGuardedGate } from "./guarded-gate.js";
import type { HoldGate } from "./ports/hold-gate.js";
import { createReservationService } from "./reservation-service.js";

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

async function reserveWith(gate: HoldGate) {
	const guarded = createGuardedGate(gate);
	const { world, saleId, ticket } = await admittedAna();
	const service = createReservationService(
		guarded,
		world.repository,
		world.saleService,
		world.queue,
		clock,
		{ rebuildWaitMs: 100, wait: async () => {} },
	);
	return service.reserve(saleId, "ana", ticket);
}

describe("the reservation service", () => {
	it("answers already_purchased when the gate knows the user bought", async () => {
		const { gate } = gateWith([{ kind: "purchased" }]);
		expect(await reserveWith(gate)).toEqual({
			ok: false,
			error: "already_purchased",
		});
	});

	it("rebuilds once and asks the gate again", async () => {
		const { gate, calls } = gateWith([
			{ kind: "not_ready" },
			{ kind: "sold_out" },
		]);
		expect(await reserveWith(gate)).toEqual({ ok: false, error: "sold_out" });
		expect(calls).toEqual({ restore: 1, lock: 1 });
	});

	it("answers unavailable when the state is still not ready after a rebuild", async () => {
		const { gate } = gateWith([{ kind: "not_ready" }, { kind: "not_ready" }]);
		expect(await reserveWith(gate)).toEqual({
			ok: false,
			error: "unavailable",
		});
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
		expect(await reserveWith(gate)).toEqual({ ok: false, error: "sold_out" });
		expect(calls.restore).toBe(0);
	});

	it("answers unavailable when the other rebuild never finishes", async () => {
		const { gate } = gateWith([{ kind: "not_ready" }], {
			lockRebuild: async () => false,
		});
		expect(await reserveWith(gate)).toEqual({
			ok: false,
			error: "unavailable",
		});
	});

	it("goes on when another instance finished the rebuild just before", async () => {
		const { gate, calls } = gateWith(
			[{ kind: "not_ready" }, { kind: "sold_out" }],
			{
				isReady: async () => true,
			},
		);
		expect(await reserveWith(gate)).toEqual({ ok: false, error: "sold_out" });
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
		expect(await reserveWith(gate)).toEqual({ ok: false, error: "sold_out" });
		expect(calls).toBe(2);
	});

	it("refuses a user id that cannot be used", async () => {
		const { world, saleId } = await admittedAna();
		expect(await world.reservations.reserve(saleId, "has space", "t")).toEqual({
			ok: false,
			error: "invalid_user",
		});
	});

	it("tells a shopper whose queue place was lost that they are not admitted", async () => {
		const { world, saleId, ticket } = await admittedAna();
		world.store.clear();
		expect(await world.reservations.reserve(saleId, "ana", ticket)).toEqual({
			ok: false,
			error: "not_admitted",
		});
	});
});
