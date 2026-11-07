// Plain Vitest tests for the reader of time phrases ("in 2 hours", "1 hour ago"). The phrases are the scenario text, so the
// literals below are the expected values.
import { describe, expect, it } from "vitest";
import { relativeTime } from "./relative-time.js";
import { MS_PER_HOUR } from "./time.js";

const NOW = new Date("2026-05-01T12:00:00.000Z");

describe("relativeTime", () => {
	it("reads 'in N hours' as that many hours after the moment", () => {
		expect(relativeTime("in 2 hours", NOW)).toEqual(
			new Date(NOW.getTime() + 2 * MS_PER_HOUR),
		);
	});

	it("reads the singular 'in 1 hour'", () => {
		expect(relativeTime("in 1 hour", NOW)).toEqual(
			new Date(NOW.getTime() + MS_PER_HOUR),
		);
	});

	it("reads 'N hours ago' as that many hours before the moment", () => {
		expect(relativeTime("2 hours ago", NOW)).toEqual(
			new Date(NOW.getTime() - 2 * MS_PER_HOUR),
		);
	});

	it("reads the singular '1 hour ago'", () => {
		expect(relativeTime("1 hour ago", NOW)).toEqual(
			new Date(NOW.getTime() - MS_PER_HOUR),
		);
	});

	it("returns a new date and leaves the moment it was given as it was", () => {
		const before = NOW.getTime();
		const read = relativeTime("in 1 hour", NOW);
		expect(read).not.toBe(NOW);
		expect(NOW.getTime()).toBe(before);
	});

	it("refuses a phrase it does not read, so a mistake in a scenario is seen", () => {
		for (const phrase of [
			"tomorrow",
			"in two hours",
			"in 2 days",
			"2 hours from now",
			"in hours",
			"1 hour ago ",
		]) {
			expect(() => relativeTime(phrase, NOW)).toThrow(
				`cannot read the time "${phrase}"`,
			);
		}
	});
});
