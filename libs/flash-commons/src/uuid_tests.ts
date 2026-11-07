// Plain Vitest tests for the UUID check that the apps share: the id of a sale, a reservation or a product. The texts below
// are the examples the check must tell apart, so their literals are the expected values.
import { describe, expect, it } from "vitest";
import { isUuid } from "./uuid.js";

describe("isUuid", () => {
	it.each([
		"0f8fad5b-d9cb-469f-a165-70867728950e",
		"0F8FAD5B-D9CB-469F-A165-70867728950E",
		"0f8FAD5b-D9cb-469F-a165-70867728950E",
	])("accepts the UUID %j in any case", (value) => {
		expect(isUuid(value)).toBe(true);
	});

	it.each([
		"",
		"not-a-uuid",
		"0f8fad5b-d9cb-469f-a165-70867728950",
		"0f8fad5b-d9cb-469f-a165-70867728950e0",
		"0f8fad5bd9cb469fa16570867728950e",
		"{0f8fad5b-d9cb-469f-a165-70867728950e}",
		" 0f8fad5b-d9cb-469f-a165-70867728950e",
		"0f8fad5b-d9cb-469f-a165-7086772895zz",
	])("refuses %j, which is not a UUID", (value) => {
		expect(isUuid(value)).toBe(false);
	});
});
