import { describe, expect, it } from "vitest";
import {
	ADMIN_ERRORS,
	CHECK_ERRORS,
	CLIENT_FAILURE_MESSAGE,
	CONFIRM_ERRORS,
	ERROR_MESSAGE,
	ERROR_STATUS,
	errorPayload,
	FIELD_ERROR,
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
	it("gives every listed code a status", () => {
		const listed = [
			...ADMIN_ERRORS,
			...JOIN_ERRORS,
			...CHECK_ERRORS,
			...RESERVE_ERRORS,
			...CONFIRM_ERRORS,
			...OUTCOME_ERRORS,
			...Object.values(FIELD_ERROR),
		];
		for (const code of listed) expect(ERROR_STATUS[code]).toBeGreaterThan(0);
	});

	it("gives every code one sentence, and no two codes share it", () => {
		const codes = Object.keys(ERROR_STATUS);
		expect(Object.keys(ERROR_MESSAGE).sort()).toEqual(codes.sort());
		const sentences = Object.values(ERROR_MESSAGE);
		for (const sentence of sentences) expect(sentence.trim()).not.toBe("");
		expect(new Set(sentences).size).toBe(sentences.length);
	});

	it("builds the body of an error from its code", () => {
		expect(errorPayload("sold_out")).toEqual({
			errorCode: "sold_out",
			errorMessage: ERROR_MESSAGE.sold_out,
		});
	});

	it("keeps the cause of an internal error out of its message", () => {
		expect(ERROR_MESSAGE.internal).toBe("Something went wrong on the server.");
	});

	it("words the two failures that the server never sends", () => {
		expect(CLIENT_FAILURE_MESSAGE.network).not.toBe("");
		expect(CLIENT_FAILURE_MESSAGE.unexpected).not.toBe("");
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
