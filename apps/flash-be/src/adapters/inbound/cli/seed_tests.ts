import { describe, expect, it } from "vitest";
import { parseSeedArgs } from "./seed-args.js";

const NOW = new Date("2026-06-01T12:00:00Z");

describe("parseSeedArgs", () => {
	it("uses the defaults for everything but the stock", () => {
		const input = parseSeedArgs(["--stock", "10"], NOW);
		expect(input).toEqual({
			name: "Flash sale",
			stock: 10,
			startsAt: NOW,
			endsAt: new Date("2026-06-01T13:00:00Z"),
			holdSeconds: 120,
			admitPerSecond: 50,
		});
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
		expect(input.name).toBe("Mug drop");
		expect(input.startsAt).toEqual(new Date("2026-06-01T12:05:00Z"));
		expect(input.endsAt).toEqual(new Date("2026-06-01T12:35:00Z"));
		expect(input.holdSeconds).toBe(90);
		expect(input.admitPerSecond).toBe(20);
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
	])("refuses %j", (args, message) => {
		expect(() => parseSeedArgs(args, NOW)).toThrow(message);
	});

	it("refuses an option it does not know", () => {
		expect(() =>
			parseSeedArgs(["--stock", "10", "--nope", "1"], NOW),
		).toThrow();
	});
});
