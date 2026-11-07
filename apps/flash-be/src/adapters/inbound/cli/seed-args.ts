// Reads the options of the seed command (seed-sale.ts) as the CLI sees them: the text becomes a NewSale, with the defaults
// the domain names. It is an inbound adapter, so it reads the command line and nothing of the database. The seed command
// checks no overlap with another sale; only an operator's create does.
import { parseArgs } from "node:util";
import type { NewSale } from "../../../domain/sale-window.js";
import {
	DEFAULT_ADMIT_PER_SECOND,
	DEFAULT_HOLD_SECONDS,
	DEFAULT_SALE_DURATION_MINUTES,
	DEFAULT_SALE_NAME,
} from "../../../domain/sale-window.js";

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
export function parseSeedArgs(argv: string[], now: Date): NewSale {
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
		DEFAULT_SALE_DURATION_MINUTES,
		1,
	);
	const startsAt = new Date(now.getTime() + startsIn * MINUTE_MS);

	return {
		name: values.name ?? DEFAULT_SALE_NAME,
		stock,
		startsAt,
		endsAt: new Date(startsAt.getTime() + duration * MINUTE_MS),
		holdSeconds: integer(
			"hold-seconds",
			values["hold-seconds"],
			DEFAULT_HOLD_SECONDS,
			1,
		),
		admitPerSecond: integer(
			"admit-per-second",
			values["admit-per-second"],
			DEFAULT_ADMIT_PER_SECOND,
			1,
		),
	};
}
