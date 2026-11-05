import { describe, expect, it } from "vitest";
import { queueWorld } from "../bdd/support/queue-world.js";
import { relativeTime } from "../bdd/support/time.js";
import { issueTicket, ticketMatches } from "./ticket.js";
import { normalizeUser } from "./user.js";

// Rules that no single scenario shows alone: the edges of the helpers behind the queue.
const NOW = new Date("2026-06-01T12:00:00Z");

async function openWorld() {
	const world = queueWorld(NOW);
	await world.addSale({
		startsAt: relativeTime("1 hour ago", NOW),
		endsAt: relativeTime("in 1 hour", NOW),
	});
	return world;
}

describe("normalizeUser", () => {
	it("refuses a value that is not text", () => {
		expect(normalizeUser(42)).toBeUndefined();
		expect(normalizeUser(undefined)).toBeUndefined();
	});

	it("accepts letters, digits and . _ @ + -", () => {
		expect(normalizeUser("  Ana.B_1@x+y-z ")).toBe("ana.b_1@x+y-z");
	});
});

describe("tickets", () => {
	it("match only the sale and user they were issued for", () => {
		const ticket = issueTicket("s", "sale-1", "ana");
		expect(ticketMatches("s", "sale-1", "ana", ticket)).toBe(true);
		expect(ticketMatches("s", "sale-2", "ana", ticket)).toBe(false);
		expect(ticketMatches("s", "sale-1", "ben", ticket)).toBe(false);
		expect(ticketMatches("other", "sale-1", "ana", ticket)).toBe(false);
	});

	it("never match a missing ticket or one of the wrong length", () => {
		expect(ticketMatches("s", "sale-1", "ana", undefined)).toBe(false);
		expect(ticketMatches("s", "sale-1", "ana", "short")).toBe(false);
	});
});

describe("the queue service", () => {
	it("refuses a check for an unknown sale and for a bad user id", async () => {
		const world = await openWorld();
		expect(await world.queue.check("nope", "ana", "t")).toEqual({
			ok: false,
			error: "sale_not_found",
		});
		expect(await world.queue.check(world.saleId, " ", "t")).toEqual({
			ok: false,
			error: "invalid_user",
		});
	});

	it("lets one admission win each tick", async () => {
		const world = await openWorld();
		await world.join("ana");
		await world.join("ben");
		const id = world.saleId;
		expect(await world.queue.admitTick(id)).toEqual(["ana", "ben"]);
		await world.join("cai");
		// Same moment, so the lease of the first tick still holds.
		expect(await world.queue.admitTick(id)).toEqual([]);
	});

	it("admits nobody for a sale that is unknown or not open", async () => {
		const world = await openWorld();
		expect(await world.queue.admitTick("nope")).toEqual([]);
		const closed = await world.addSale({
			endsAt: relativeTime("1 hour ago", NOW),
		});
		expect(await world.queue.admitTick(closed)).toEqual([]);
	});

	it("reads a request with no ticket header as a wrong ticket", async () => {
		const world = await openWorld();
		await world.join("ana");
		const reply = await world.check("ana");
		expect(reply.statusCode).toBe(401);
	});
});
