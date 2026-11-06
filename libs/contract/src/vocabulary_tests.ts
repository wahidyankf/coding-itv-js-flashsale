import { describe, expect, it } from "vitest";
import {
	ADMIN_ERRORS,
	CHECK_ERRORS,
	COMMON_ERRORS,
	CONFIRM_ERRORS,
	ERROR_STATUS,
	FIELD_ERROR,
	isErrorCode,
	isUuid,
	JOIN_ERRORS,
	normalizeUserId,
	OUTCOME_ERRORS,
	RESERVE_ERRORS,
	USER_ID_PATTERN,
} from "./vocabulary.js";

describe("normalizeUserId", () => {
	it("trims and lowercases a name", () => {
		expect(normalizeUserId("  Ana ")).toBe("ana");
	});

	it.each([
		["not a string", 5],
		["empty", ""],
		["only spaces", "   "],
		["starts with a dot", ".ana"],
		["has a space inside", "an a"],
		["too long", "a".repeat(65)],
	])("refuses a name that is %s", (_why, raw) => {
		expect(normalizeUserId(raw)).toBeUndefined();
	});

	it("accepts the longest name and the allowed symbols", () => {
		expect(normalizeUserId("a".repeat(64))).toHaveLength(64);
		expect(normalizeUserId("a.b_c@d+e-f")).toBe("a.b_c@d+e-f");
		expect(USER_ID_PATTERN.test("a")).toBe(true);
	});
});

describe("isUuid", () => {
	it("accepts a UUID in either case and refuses anything else", () => {
		expect(isUuid("0f8fad5b-d9cb-469f-a165-70867728950e")).toBe(true);
		expect(isUuid("0F8FAD5B-D9CB-469F-A165-70867728950E")).toBe(true);
		expect(isUuid("not-a-uuid")).toBe(false);
	});
});

describe("error codes", () => {
	it("knows a code and refuses other values", () => {
		expect(isErrorCode("sold_out")).toBe(true);
		expect(isErrorCode("toString")).toBe(false);
		expect(isErrorCode(404)).toBe(false);
	});

	it("gives every listed code a status", () => {
		const listed = [
			...ADMIN_ERRORS,
			...JOIN_ERRORS,
			...CHECK_ERRORS,
			...RESERVE_ERRORS,
			...CONFIRM_ERRORS,
			...OUTCOME_ERRORS,
			...COMMON_ERRORS,
			...Object.values(FIELD_ERROR),
		];
		for (const code of listed) expect(ERROR_STATUS[code]).toBeGreaterThan(0);
	});

	it("keeps the statuses the API has always answered with", () => {
		expect(ERROR_STATUS).toMatchObject({
			sale_not_found: 404,
			invalid_user: 400,
			invalid_ticket: 401,
			payment_failed: 402,
			not_admitted: 403,
			sold_out: 409,
			rate_limited: 429,
			unavailable: 503,
			invalid_sale: 400,
			invalid_admin_token: 401,
			sale_overlaps: 409,
		});
	});
});
