// Reads the seed command's options (seed-sale.ts). This inbound adapter turns the text into a sale the domain accepts,
// with the domain's defaults. A bad option is a message to print, not an exception. The seed does not check for an
// overlap with another sale; only an operator's create does.

import { parseArgs } from "node:util";
import { MS_PER_MINUTE } from "@flash/flash-commons";
import { attempt, Err, Ok, type Result } from "@flash/typekit";
import {
	DEFAULT_ADMIT_PER_SECOND,
	DEFAULT_HOLD_SECONDS,
	DEFAULT_SALE_DURATION_MINUTES,
	type NewSale,
	newSaleFrom,
} from "../../../domain/sale-window.js";

// The refusal for a window or a hold the domain will not take. The domain does not say which part broke, so this names
// the parts.
const UNUSABLE_SALE =
	"the sale is not usable: its name, window or holds are out of range";

// Options arrive as text, so each one is checked here, before the domain sees it. A missing option uses its fallback
// when it has one.
function integer(
	option: string,
	raw: string | undefined,
	fallback: number | undefined,
	min: number,
): Result<number, string> {
	if (raw === undefined && fallback !== undefined) return new Ok(fallback);
	const value = Number(raw);
	if (raw === undefined || !Number.isInteger(value) || value < min) {
		return new Err(
			`${option} must be a ${min === 0 ? "non-negative" : "positive"} integer`,
		);
	}
	return new Ok(value);
}

// Turns the seed command's options into a sale, or into the message to print. The window is in minutes from `now`.
export function parseSeedArgs(
	argv: string[],
	now: Date,
): Result<NewSale, string> {
	const parsed = attempt(
		() =>
			parseArgs({
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
			}),
		Error,
	);
	if (parsed.isErr()) return new Err(parsed.error.message);
	const { values } = parsed.value;

	const stock = integer("stock", values.stock, undefined, 1);
	if (stock.isErr()) return new Err(stock.error);
	const startsIn = integer(
		"starts-in-minutes",
		values["starts-in-minutes"],
		0,
		0,
	);
	if (startsIn.isErr()) return new Err(startsIn.error);
	const duration = integer(
		"duration-minutes",
		values["duration-minutes"],
		DEFAULT_SALE_DURATION_MINUTES,
		1,
	);
	if (duration.isErr()) return new Err(duration.error);
	const holdSeconds = integer(
		"hold-seconds",
		values["hold-seconds"],
		DEFAULT_HOLD_SECONDS,
		1,
	);
	if (holdSeconds.isErr()) return new Err(holdSeconds.error);
	const admitPerSecond = integer(
		"admit-per-second",
		values["admit-per-second"],
		DEFAULT_ADMIT_PER_SECOND,
		1,
	);
	if (admitPerSecond.isErr()) return new Err(admitPerSecond.error);

	const startsAt = new Date(now.getTime() + startsIn.value * MS_PER_MINUTE);
	const endsAt = new Date(startsAt.getTime() + duration.value * MS_PER_MINUTE);
	// A window past the range of a date has no text form, so it is refused before the domain sees it.
	if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) {
		return new Err(UNUSABLE_SALE);
	}
	const sale = newSaleFrom({
		name: values.name,
		stock: stock.value,
		startsAt: startsAt.toISOString(),
		endsAt: endsAt.toISOString(),
		holdSeconds: holdSeconds.value,
		admitPerSecond: admitPerSecond.value,
	});
	if (sale.isErr()) return new Err(UNUSABLE_SALE);
	return new Ok(sale.value);
}
