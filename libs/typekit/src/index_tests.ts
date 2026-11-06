import { describe, expect, it } from "vitest";
import * as typekit from "./index.js";

describe("public surface", () => {
	it("exports exactly the documented names", () => {
		expect(Object.keys(typekit).sort()).toEqual([
			"Err",
			"Ok",
			"assertNever",
			"attempt",
			"attemptAsync",
			"pipe",
			"result",
			"satisfying",
		]);
	});

	it("reaches the curried combinators through their namespace", () => {
		expect(Object.keys(typekit.result).sort()).toContain("flatMapErr");
	});
});
