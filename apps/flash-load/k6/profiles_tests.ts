// Unit tests of the virtual-user pools of the herd profiles (burst and contention): a pool must hold more virtual users
// than shoppers, so the last arrival of the herd gets one, and it must stay under the ceiling the test machine was
// measured to start. The rule is checked, not the numbers.
import { describe, expect, it } from "vitest";
import { PROFILES } from "./profiles.ts";

// The most virtual users the test machine was measured to start is 1,186 (see docs/explanation/load-test-findings.md).
// A pool stays under 1,000 to keep a margin below that.
const VU_CEILING = 1000;
const HERD_PROFILES = ["burst", "contention"] as const;

describe("the virtual-user pool of a herd profile", () => {
	it.each(HERD_PROFILES)(
		"%s holds more virtual users than shoppers, so no arrival is dropped",
		(name) => {
			expect(PROFILES[name].maxVUs).toBeGreaterThan(PROFILES[name].users);
		},
	);

	it.each(HERD_PROFILES)(
		"%s stays under the ceiling the machine was measured to start",
		(name) => {
			expect(PROFILES[name].maxVUs).toBeLessThanOrEqual(VU_CEILING);
		},
	);
});
