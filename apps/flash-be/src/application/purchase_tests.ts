import { describe, expect, it } from "vitest";
import { queueWorld } from "../bdd/support/queue-world.js";
import { relativeTime } from "../bdd/support/time.js";

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
	it("refuses an unknown sale and a bad user id", async () => {
		const world = await boughtByAna();
		const unknown = await world.confirm("ana", {
			saleId: "00000000-0000-4000-8000-000000000000",
			reservationId: "00000000-0000-4000-8000-000000000001",
		});
		expect(unknown.json().error).toBe("sale_not_found");
		const bad = await world.confirm("has space", {
			reservationId: "00000000-0000-4000-8000-000000000001",
		});
		expect(bad.json().error).toBe("invalid_user");
	});

	it("does not hand a purchase to somebody who is not its buyer", async () => {
		const world = await boughtByAna();
		const reply = await world.confirm("ben", { owner: "ana" });
		expect(reply.statusCode).toBe(404);
		expect(reply.json().error).toBe("reservation_not_found");
	});

	it("refuses a second reservation of a user who already bought", async () => {
		const world = await boughtByAna();
		const reservationId = crypto.randomUUID();
		world.repository.rows.set(`${world.saleId}:ana`, {
			saleId: world.saleId,
			user: "ana",
			reservationId,
			expiresAt: new Date(NOW.getTime() + 60_000),
		});
		const reply = await world.confirm("ana", { reservationId });
		expect(reply.statusCode).toBe(409);
		expect(reply.json().error).toBe("already_purchased");
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
			user: "ana",
			reservationId,
			expiresAt: new Date(NOW.getTime() + 60_000),
		});
		const reply = await world.confirm("ana", { reservationId });
		expect(reply.json().error).toBe("sale_ended");
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
