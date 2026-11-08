// Unit test for the silent logger of logger.ts: every level can be called, and none of them writes or throws.
import { describe, expect, it } from "vitest";
import { silentLogger } from "./logger.js";

describe("silentLogger", () => {
	it("takes a line at every level and writes nothing", () => {
		for (const level of ["debug", "info", "warn", "error"] as const) {
			expect(silentLogger[level]({ saleId: "s" }, "a line")).toBeUndefined();
		}
	});
});
