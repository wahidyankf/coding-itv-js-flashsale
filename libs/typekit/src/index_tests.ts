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
