import { randomUUID } from "node:crypto";
import { parseArgs } from "node:util";
import type { Kysely } from "kysely";
import type { Database } from "../db.js";

export type SeedInput = {
	name: string;
	stock: number;
	startsAt: Date;
	endsAt: Date;
	reservationTtlSeconds: number;
	admitPerSecond: number;
};

const MINUTE_MS = 60_000;

function integer(
	option: string,
	raw: string | undefined,
	fallback: number | undefined,
	min: number,
): number {
	if (raw === undefined && fallback !== undefined) return fallback;
	const value = Number(raw);
	if (raw === undefined || !Number.isInteger(value) || value < min) {
		throw new Error(
			`${option} must be a ${min === 0 ? "non-negative" : "positive"} integer`,
		);
	}
	return value;
}

// Reads the seed command's options. The window is given in minutes, relative to now.
export function parseSeedArgs(argv: string[], now: Date): SeedInput {
	const { values } = parseArgs({
		args: argv,
		options: {
			name: { type: "string" },
			stock: { type: "string" },
			"starts-in-minutes": { type: "string" },
			"duration-minutes": { type: "string" },
			"hold-seconds": { type: "string" },
			"admit-per-second": { type: "string" },
		},
		strict: true,
	});

	const stock = integer("stock", values.stock, undefined, 1);
	const startsIn = integer(
		"starts-in-minutes",
		values["starts-in-minutes"],
		0,
		0,
	);
	const duration = integer(
		"duration-minutes",
		values["duration-minutes"],
		60,
		1,
	);
	const startsAt = new Date(now.getTime() + startsIn * MINUTE_MS);

	return {
		name: values.name ?? "Flash sale",
		stock,
		startsAt,
		endsAt: new Date(startsAt.getTime() + duration * MINUTE_MS),
		reservationTtlSeconds: integer(
			"hold-seconds",
			values["hold-seconds"],
			120,
			1,
		),
		admitPerSecond: integer(
			"admit-per-second",
			values["admit-per-second"],
			50,
			1,
		),
	};
}

// Creates the sale and returns its id. The id is made here, so the insert needs no returned row.
export async function seedSale(
	db: Kysely<Database>,
	input: SeedInput,
): Promise<string> {
	const id = randomUUID();
	await db
		.insertInto("sales")
		.values({
			id,
			name: input.name,
			starts_at: input.startsAt,
			ends_at: input.endsAt,
			stock: input.stock,
			reservation_ttl_seconds: input.reservationTtlSeconds,
			admit_per_second: input.admitPerSecond,
		})
		.execute();
	return id;
}
