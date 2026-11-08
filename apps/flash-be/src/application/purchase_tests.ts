// The purchase use case, against fake stores: what a confirm and an outcome answer, in the order the checks run.

import { describe, expect, it } from "vitest";
import { queueWorld } from "../bdd/support/queue-world.js";
import { relativeTime } from "../bdd/support/time.js";
import { usernameOf } from "../bdd/support/users.js";

// Answers that no scenario reaches by itself: odd requests, and a purchase row that Postgres would refuse.
const NOW = new Date("2026-06-01T12:00:00Z");

async function boughtByAna() {
	const world = queueWorld(NOW);
	await world.addSale({
		stock: 5,
		startsAt: relativeTime("1 hour ago", NOW),
		endsAt: relativeTime("in 1 hour", NOW),
	});
	await world.admitted("ana");
	await world.reserve("ana");
	await world.confirm("ana");
	return world;
}

describe("confirming a purchase", () => {
	it("refuses an unknown sale", async () => {
		const world = await boughtByAna();
		const unknown = await world.confirm("ana", {
			saleId: "00000000-0000-4000-8000-000000000000",
			reservationId: "00000000-0000-4000-8000-000000000001",
		});
		expect(unknown.json().errorCode).toBe("sale_not_found");
	});

	it("does not hand a purchase to somebody who is not its buyer", async () => {
		const world = await boughtByAna();
		const reply = await world.confirm("ben", { owner: "ana" });
		expect(reply.statusCode).toBe(404);
		expect(reply.json().errorCode).toBe("reservation_not_found");
	});

	it("refuses a second reservation of a user who already bought", async () => {
		const world = await boughtByAna();
		const reservationId = crypto.randomUUID();
		world.repository.rows.set(`${world.saleId}:ana`, {
			saleId: world.saleId,
			user: usernameOf("ana"),
			reservationId,
			expiresAt: new Date(NOW.getTime() + 60_000),
		});
		const reply = await world.confirm("ana", { reservationId });
		expect(reply.statusCode).toBe(409);
		expect(reply.json().errorCode).toBe("already_purchased");
	});

	it("refuses a hold of a sale that has ended", async () => {
		const world = queueWorld(NOW);
		await world.addSale({
			startsAt: relativeTime("2 hours ago", NOW),
			endsAt: relativeTime("1 hour ago", NOW),
		});
		const reservationId = crypto.randomUUID();
		world.repository.rows.set(`${world.saleId}:ana`, {
			saleId: world.saleId,
			user: usernameOf("ana"),
			reservationId,
			expiresAt: new Date(NOW.getTime() + 60_000),
		});
		const reply = await world.confirm("ana", { reservationId });
		expect(reply.json().errorCode).toBe("sale_ended");
	});

	it("still answers when Redis cannot be told about the purchase", async () => {
		const world = queueWorld(NOW);
		await world.addSale({
			startsAt: relativeTime("1 hour ago", NOW),
			endsAt: relativeTime("in 1 hour", NOW),
		});
		await world.admitted("ana");
		await world.reserve("ana");
		world.gate.confirm = async () => {
			throw new Error("redis is down");
		};
		expect((await world.confirm("ana")).statusCode).toBe(201);
	});
});

// Two confirmations of one hold at once: the other one commits after this one first looked for a purchase of the
// reservation, so a later check finds the purchase, or finds the hold already spent. This one is then a repeat.
describe("a confirmation that the other confirmation of the same hold overtakes", () => {
	// Answers like `real`, except that its first call finds nothing, as if the other commit had not landed yet.
	function missOnce<A extends unknown[], T>(
		real: (...args: A) => Promise<T | undefined>,
	): (...args: A) => Promise<T | undefined> {
		let missed = false;
		return async (...args) => {
			if (missed) return real(...args);
			missed = true;
			return undefined;
		};
	}

	// Ana has bought, and her purchase is missed once by the lookup of the reservation, and also by the lookup of her
	// purchase in the sale when `alsoByUser` is set.
	async function overtaken(alsoByUser: boolean) {
		const world = await boughtByAna();
		const repository = world.purchaseRepository;
		repository.findByReservation = missOnce(repository.findByReservation);
		if (alsoByUser) repository.findByUser = missOnce(repository.findByUser);
		return world;
	}

	it("answers the same purchase when the purchase check already sees it", async () => {
		const world = await overtaken(false);
		const reply = await world.confirm("ana");
		expect(reply.statusCode).toBe(200);
		expect(reply.json().purchaseId).toBe(
			world.purchases.get("ana")?.purchaseId,
		);
	});

	it("answers the same purchase, not reservation_not_found, when the hold is already spent", async () => {
		const world = await overtaken(true);
		const reply = await world.confirm("ana");
		expect(reply.statusCode).toBe(200);
		expect(reply.json().purchaseId).toBe(
			world.purchases.get("ana")?.purchaseId,
		);
		expect(
			(await world.payment.statusOf(reply.json().reservationId))?.attempts,
		).toBe(1);
	});

	it("still answers reservation_not_found for a hold that is gone with no purchase of it", async () => {
		const world = queueWorld(NOW);
		await world.addSale({
			startsAt: relativeTime("1 hour ago", NOW),
			endsAt: relativeTime("in 1 hour", NOW),
		});
		const reply = await world.confirm("ana", {
			reservationId: "00000000-0000-4000-8000-000000000001",
		});
		expect(reply.statusCode).toBe(404);
		expect(reply.json().errorCode).toBe("reservation_not_found");
	});
});

// A charge that went through is given back when the commit fails, so a shopper is never charged for nothing. The reply
// stays what it was for an unexpected failure: the shopper gets the generic 500, not a purchase.
describe("a commit that fails after the charge", () => {
	it("refunds the charge once and answers the generic internal failure", async () => {
		const world = queueWorld(NOW);
		await world.addSale({
			stock: 5,
			startsAt: relativeTime("1 hour ago", NOW),
			endsAt: relativeTime("in 1 hour", NOW),
		});
		await world.admitted("ana");
		await world.reserve("ana");
		const reservationId = world.holds.get("ana")?.reservationId;
		world.purchaseRepository.commit = async () => {
			throw new Error("postgres is unreachable");
		};

		const reply = await world.confirm("ana");
		expect(reply.statusCode).toBe(500);
		expect(reply.json().errorCode).toBe("internal");
		expect((await world.payment.statusOf(reservationId ?? ""))?.status).toBe(
			"refunded",
		);
	});

	// A commit that threw may still have written the purchase: the reply was lost, not the write. The purchase is then
	// the answer, and the charge is kept, because the shopper did get the item.
	it("answers the purchase that was written when the reply of the commit was lost, and refunds nothing", async () => {
		const world = queueWorld(NOW);
		await world.addSale({
			stock: 5,
			startsAt: relativeTime("1 hour ago", NOW),
			endsAt: relativeTime("in 1 hour", NOW),
		});
		await world.admitted("ana");
		await world.reserve("ana");
		const reservationId = world.holds.get("ana")?.reservationId;
		const written = world.purchaseRepository.commit;
		world.purchaseRepository.commit = async (input) => {
			await written(input);
			throw new Error("the reply was lost");
		};

		const reply = await world.confirm("ana");
		expect(reply.statusCode).toBe(201);
		expect(reply.json().reservationId).toBe(reservationId);
		expect((await world.payment.statusOf(reservationId ?? ""))?.status).toBe(
			"charged",
		);
	});

	// A purchase found under the reservation that is not this shopper's, or not this sale's, is not the answer: the
	// charge is refunded and the failure goes on as before.
	it("refunds the charge when the purchase found after a lost commit belongs to someone else", async () => {
		const world = queueWorld(NOW);
		await world.addSale({
			stock: 5,
			startsAt: relativeTime("1 hour ago", NOW),
			endsAt: relativeTime("in 1 hour", NOW),
		});
		await world.admitted("ana");
		await world.reserve("ana");
		const reservationId = world.holds.get("ana")?.reservationId;
		let commitFailed = false;
		world.purchaseRepository.commit = async () => {
			commitFailed = true;
			throw new Error("the reply was lost");
		};
		world.purchaseRepository.findByReservation = async () =>
			commitFailed
				? {
						id: crypto.randomUUID(),
						saleId: world.saleId,
						user: usernameOf("ben"),
						reservationId: reservationId ?? "",
						paymentRef: "mock-other",
						purchasedAt: NOW,
					}
				: undefined;

		const reply = await world.confirm("ana");
		expect(reply.statusCode).toBe(500);
		expect(reply.json().errorCode).toBe("internal");
		expect((await world.payment.statusOf(reservationId ?? ""))?.status).toBe(
			"refunded",
		);
	});

	// The lookup of the purchase fails too, most likely because Postgres is down, so the commit most likely never landed:
	// the charge is refunded and the failure goes on as before.
	it("refunds the charge when the commit fails and the lookup after it fails too", async () => {
		const world = queueWorld(NOW);
		await world.addSale({
			stock: 5,
			startsAt: relativeTime("1 hour ago", NOW),
			endsAt: relativeTime("in 1 hour", NOW),
		});
		await world.admitted("ana");
		await world.reserve("ana");
		const reservationId = world.holds.get("ana")?.reservationId;
		const found = world.purchaseRepository.findByReservation;
		let commitFailed = false;
		world.purchaseRepository.commit = async () => {
			commitFailed = true;
			throw new Error("postgres is unreachable");
		};
		world.purchaseRepository.findByReservation = async (id) => {
			if (commitFailed) throw new Error("postgres is unreachable");
			return found(id);
		};

		const reply = await world.confirm("ana");
		expect(reply.statusCode).toBe(500);
		expect(reply.json().errorCode).toBe("internal");
		expect((await world.payment.statusOf(reservationId ?? ""))?.status).toBe(
			"refunded",
		);
	});
});
