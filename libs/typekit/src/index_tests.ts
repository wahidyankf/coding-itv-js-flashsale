// Unit test for the public surface of @flash/typekit: the names index.ts exports, and no others.
import { describe, expect, it } from "vitest";
import * as typekit from "./index.js";

describe("public surface", () => {
	it("exports exactly the documented names", () => {
		expect(Object.keys(typekit).sort()).toEqual([
			"Err",
			"Ok",
			"attempt",
			"attemptAsync",
		]);
	});
});
