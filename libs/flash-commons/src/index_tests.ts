// The public surface of @flash/flash-commons. A test fails when a name is added or dropped without a change here.
import { describe, expect, expectTypeOf, it } from "vitest";
import type { BackoffPolicy, RetryPolicy } from "./index.js";
import * as commons from "./index.js";

describe("public surface", () => {
	it("exports exactly the documented names", () => {
		expect(Object.keys(commons).sort()).toEqual([
			"backoffDelayMs",
			"retry",
			"retryAsync",
		]);
	});

	it("exports the policy types, with a retry policy that carries a backoff policy", () => {
		expectTypeOf<RetryPolicy>().toExtend<BackoffPolicy>();
	});
});
