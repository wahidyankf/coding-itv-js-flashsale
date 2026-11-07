// Unit tests for the time formats: UTC for the first text, the viewer's own zone after that.
import { describe, expect, it } from "vitest";
import { formatLocal, formatUtc } from "./format";

describe("formatUtc", () => {
	it("writes the same English text everywhere, with the zone", () => {
		expect(formatUtc("2026-06-01T11:05:00Z")).toBe("1 Jun 2026, 11:05 UTC");
	});

	it("gives back text that is not a date", () => {
		expect(formatUtc("soon")).toBe("soon");
	});
});

describe("formatLocal", () => {
	it("writes the date and the time of the viewer", () => {
		const text = formatLocal("2026-06-01T11:05:00Z");
		expect(text).toContain("2026");
		expect(text).not.toContain("UTC");
	});

	it("gives back text that is not a date", () => {
		expect(formatLocal("soon")).toBe("soon");
	});
});
