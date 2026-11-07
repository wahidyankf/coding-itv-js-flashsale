// Plain Vitest tests for the time units. The units are the standard lengths, so the literals below are the expected values.
import { describe, expect, it } from "vitest";
import { MS_PER_HOUR, MS_PER_MINUTE, MS_PER_SECOND } from "./time.js";

describe("time units", () => {
	it("counts milliseconds in a second, a minute and an hour", () => {
		expect(MS_PER_SECOND).toBe(1000);
		expect(MS_PER_MINUTE).toBe(60_000);
		expect(MS_PER_HOUR).toBe(3_600_000);
	});

	it("builds each unit from the one below it", () => {
		expect(MS_PER_MINUTE).toBe(60 * MS_PER_SECOND);
		expect(MS_PER_HOUR).toBe(60 * MS_PER_MINUTE);
	});
});
