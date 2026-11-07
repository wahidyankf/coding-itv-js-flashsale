// The two sale rules that run twice: whether two windows overlap, and which sale is the current one at a moment. The
// domain decides them in memory, and SQL decides them in the database; the unit layer uses the first and the database
// uses the second. These cases hold each side to the other on the same windows, so a change to one that the other does
// not follow fails here. Integration test, against the real tables.
import { afterAll, describe, expect, it } from "vitest";
import { config } from "../../../config.js";
import { SYSTEM_USERNAME } from "../../../domain/actors.js";
import { pickCurrent, type Sale } from "../../../domain/sale.js";
import { overlaps } from "../../../domain/sale-window.js";
import { createDb } from "./database.js";
import { createPostgresSaleAdmin } from "./sale-admin.js";
import { createSaleRepository } from "./sale-repository.js";
import { actorId } from "./users.js";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
// The windows sit far in the future, each block of them apart, so no case meets a sale that is not its own.
const FIRST_BLOCK = Date.parse("2900-01-01T00:00:00Z");
const BLOCK_DAYS = 2;

const db = createDb(config.databaseUrl);
const admin = createPostgresSaleAdmin(db);
const reads = createSaleRepository(db);

afterAll(async () => {
	await db.destroy();
});

// The start of a block, and the hours of a window measured from it.
const blockAt = (block: number, hours: number) =>
	new Date(FIRST_BLOCK + block * BLOCK_DAYS * DAY + hours * HOUR);

// A sale with the given window and the defaults the operator would leave out.
const windowOf = (startsAt: Date, endsAt: Date) => ({
	name: "Sale rules",
	stock: 10,
	startsAt,
	endsAt,
	holdSeconds: 120,
	admitPerSecond: 50,
});

// The window pairs the overlap rule decides, in hours from a block's start. A window that starts when another ends does
// not overlap it: that boundary is the one a `<` for `<=` change would move.
const OVERLAP_CASES = [
	{
		name: "a window that starts when another ends does not overlap it",
		existing: [0, 1],
		candidate: [1, 2],
		overlap: false,
	},
	{
		name: "a window that ends when another starts does not overlap it",
		existing: [1, 2],
		candidate: [0, 1],
		overlap: false,
	},
	{
		name: "a window inside another overlaps it",
		existing: [0, 3],
		candidate: [1, 2],
		overlap: true,
	},
	{
		name: "a window that holds another overlaps it",
		existing: [1, 2],
		candidate: [0, 3],
		overlap: true,
	},
	{
		name: "windows that share part of their time overlap",
		existing: [0, 2],
		candidate: [1, 3],
		overlap: true,
	},
	{
		name: "windows apart in time do not overlap",
		existing: [0, 1],
		candidate: [2, 3],
		overlap: false,
	},
] as const;

describe("overlapping windows", () => {
	it.each(OVERLAP_CASES.map((c, block) => ({ ...c, block })))(
		"$name",
		async ({ existing, candidate, overlap, block }) => {
			const actor = await actorId(db, SYSTEM_USERNAME);
			const [eStart = 0, eEnd = 0] = existing;
			const [cStart = 0, cEnd = 0] = candidate;
			const first = await admin.create(
				windowOf(blockAt(block, eStart), blockAt(block, eEnd)),
				actor,
			);
			expect(first.isOk()).toBe(true);
			if (first.isErr()) return;
			try {
				const domainSays = overlaps(
					{ startsAt: blockAt(block, eStart), endsAt: blockAt(block, eEnd) },
					{ startsAt: blockAt(block, cStart), endsAt: blockAt(block, cEnd) },
				);
				const second = await admin.create(
					windowOf(blockAt(block, cStart), blockAt(block, cEnd)),
					actor,
				);
				const sqlSays = second.isErr() && second.error === "sale_overlaps";
				if (second.isOk()) await admin.remove(second.value.id, actor);
				expect(domainSays).toBe(overlap);
				expect(sqlSays).toBe(overlap);
			} finally {
				await admin.remove(first.value.id, actor);
			}
		},
	);
});

// Hours from the block of the current sale, and which of three sales is current then (undefined: none). The sales are one
// that ended, one running and one upcoming, with a gap between each pair, so each has moments where it is the answer.
const CURRENT_WINDOWS = [
	[-3, -2],
	[-1, 1],
	[2, 3],
] as const;
const CURRENT_MOMENTS: ReadonlyArray<readonly [number, number | undefined]> = [
	[-4, 0],
	[-2.5, 0],
	[-1.5, 1],
	[0, 1],
	[1, 2],
	[2.5, 2],
	[3.5, undefined],
];

describe("the current sale", () => {
	it("is the same in SQL and in the domain at every moment around three sales", async () => {
		const actor = await actorId(db, SYSTEM_USERNAME);
		const block = OVERLAP_CASES.length;
		const made: string[] = [];
		try {
			for (const [start, end] of CURRENT_WINDOWS) {
				const result = await admin.create(
					windowOf(blockAt(block, start), blockAt(block, end)),
					actor,
				);
				expect(result.isOk()).toBe(true);
				if (result.isOk()) made.push(result.value.id);
			}
			const stored = await Promise.all(made.map((id) => reads.findById(id)));
			const ours = stored.filter((sale): sale is Sale => sale !== undefined);
			expect(ours).toHaveLength(CURRENT_WINDOWS.length);

			for (const [hours, expected] of CURRENT_MOMENTS) {
				const now = blockAt(block, hours);
				const domainPick = pickCurrent(ours, now)?.id;
				const sqlPick = (await reads.findCurrent(now))?.id;
				expect(sqlPick).toBe(domainPick);
				expect(domainPick).toBe(
					expected === undefined ? undefined : made[expected],
				);
			}
		} finally {
			for (const id of made) await admin.remove(id, actor);
		}
	});
});
