// The public surface of @flash/flash-commons. A test fails when a name is added or dropped without a change here.
import { describe, expect, expectTypeOf, it } from "vitest";
import type { BackoffPolicy, RetryPolicy } from "./index.js";
import * as commons from "./index.js";

describe("public surface", () => {
	it("exports exactly the documented names", () => {
		expect(Object.keys(commons).sort()).toEqual([
			"API_PATHS",
			"API_PREFIX",
			"AUTH_BASE_PATH",
			"FIRST_ERROR_STATUS",
			"FIRST_SERVER_ERROR_STATUS",
			"HTTP_STATUS",
			"MS_PER_HOUR",
			"MS_PER_MINUTE",
			"MS_PER_SECOND",
			"PROBE_PATHS",
			"applySetCookies",
			"backoffDelayMs",
			"both",
			"cookieHeader",
			"cookieHeaderOf",
			"integer",
			"isUuid",
			"isoDate",
			"literal",
			"nonEmptyText",
			"nonNegativeInteger",
			"object",
			"oneOf",
			"optional",
			"parseSetCookie",
			"refine",
			"relativeTime",
			"retry",
			"retryAsync",
			"tagged",
			"text",
			"uuid",
		]);
	});

	it("exports the policy types, with a retry policy that carries a backoff policy", () => {
		expectTypeOf<RetryPolicy>().toExtend<BackoffPolicy>();
	});
});
