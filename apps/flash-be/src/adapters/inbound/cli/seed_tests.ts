// Unit tests for the seed command's options: the defaults, every option it reads, and the refusals of a bad name, date or flag.
import { Ok } from "@flash/typekit";
import { describe, expect, it } from "vitest";
import { parseSeedArgs } from "./seed-args.js";

const NOW = new Date("2026-06-01T12:00:00Z");

// The command's refusal for a sale the domain will not take, whatever the option that broke it.
const UNUSABLE_SALE =
	"the sale is not usable: its name, window or holds are out of range";

// A bad option is a value the command prints, not an exception: the parser says why and makes no sale.
describe("parseSeedArgs", () => {
	it("uses the defaults for everything but the stock", () => {
		expect(parseSeedArgs(["--stock", "10"], NOW)).toEqual(
			new Ok({
				name: "Flash sale",
				stock: 10,
				startsAt: NOW,
				endsAt: new Date("2026-06-01T13:00:00Z"),
				holdSeconds: 120,
				admitPerSecond: 50,
			}),
		);
	});

	it("reads every option", () => {
		const input = parseSeedArgs(
			[
				"--stock",
				"10",
				"--name",
				"Mug drop",
				"--starts-in-minutes",
				"5",
				"--duration-minutes",
				"30",
				"--hold-seconds",
				"90",
				"--admit-per-second",
				"20",
			],
			NOW,
		);
		expect(input).toEqual(
			new Ok({
				name: "Mug drop",
				stock: 10,
				startsAt: new Date("2026-06-01T12:05:00Z"),
				endsAt: new Date("2026-06-01T12:35:00Z"),
				holdSeconds: 90,
				admitPerSecond: 20,
			}),
		);
	});

	it.each([
		[[], "stock must be a positive integer"],
		[["--stock", "1.5"], "stock must be a positive integer"],
		[
			["--stock", "10", "--starts-in-minutes=-1"],
			"starts-in-minutes must be a non-negative integer",
		],
		[
			["--stock", "10", "--duration-minutes", "0"],
			"duration-minutes must be a positive integer",
		],
		[
			["--stock", "10", "--hold-seconds", "abc"],
			"hold-seconds must be a positive integer",
		],
		[
			["--stock", "10", "--admit-per-second", "0"],
			"admit-per-second must be a positive integer",
		],
	])("refuses %j with the rule it broke", (args, message) => {
		const refused = parseSeedArgs(args, NOW);
		expect(refused.isErr() && refused.error).toBe(message);
	});

	it("refuses a name the domain will not take", () => {
		const refused = parseSeedArgs(["--stock", "10", "--name", "   "], NOW);
		expect(refused.isErr() && refused.error).toBe(UNUSABLE_SALE);
	});

	it("refuses a window past the range of a date", () => {
		const refused = parseSeedArgs(
			["--stock", "10", "--starts-in-minutes", "1e20"],
			NOW,
		);
		expect(refused.isErr() && refused.error).toBe(UNUSABLE_SALE);
	});

	it("refuses an option it does not know", () => {
		const refused = parseSeedArgs(["--stock", "10", "--nope", "1"], NOW);
		expect(refused.isErr()).toBe(true);
	});
});
