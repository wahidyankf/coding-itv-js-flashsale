import { describe, expect, it } from "vitest";
import * as typekit from "./index.js";

describe("public surface", () => {
	it("exports exactly the documented names", () => {
		expect(Object.keys(typekit).sort()).toEqual([
			"Err",
			"Ok",
			"Some",
			"assertNever",
			"attempt",
			"attemptAsync",
			"fromOptional",
			"option",
			"pipe",
			"result",
			"satisfying",
		]);
	});

	it("reaches the curried combinators through their namespaces", () => {
		expect(Object.keys(typekit.result).sort()).toContain("flatMapErr");
		expect(Object.keys(typekit.option).sort()).toContain("okOr");
	});
});
