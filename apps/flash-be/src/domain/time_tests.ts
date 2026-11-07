// The live check: a session or a hold is live until its end moment, and no longer live at that moment.
import { describe, expect, it } from "vitest";
import { isLive } from "./time.js";

describe("isLive", () => {
	it("counts a hold only until its end time", () => {
		const hold = { expiresAt: new Date("2026-01-01T10:01:00Z") };
		expect(isLive(hold, new Date("2026-01-01T10:00:59Z"))).toBe(true);
		expect(isLive(hold, new Date("2026-01-01T10:01:00Z"))).toBe(false);
	});
});
