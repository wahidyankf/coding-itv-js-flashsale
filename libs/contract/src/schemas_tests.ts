import { describe, expect, expectTypeOf, it } from "vitest";
import {
	ErrorBody,
	errorBody,
	errorReplies,
	JoinedView,
	OutcomeView,
	PlaceView,
	ReadyView,
	SaleView,
} from "./schemas.js";
import { CONFIRM_ERRORS, errorPayload } from "./vocabulary.js";

describe("errorReplies", () => {
	it("groups the codes by HTTP status", () => {
		const replies = errorReplies(CONFIRM_ERRORS);
		expect(Object.keys(replies).sort()).toEqual(
			["400", "402", "404", "409"].sort(),
		);
		expect(replies[409].safeParse(errorPayload("sold_out")).success).toBe(true);
		expect(replies[409].safeParse(errorPayload("invalid_user")).success).toBe(
			false,
		);
		expect(replies[400].safeParse(errorPayload("invalid_user")).success).toBe(
			true,
		);
	});

	it("types each status with only its own codes", () => {
		const replies = errorReplies(["sale_not_found", "sold_out"]);
		expectTypeOf<Parameters<(typeof replies)[404]["parse"]>[0]>().toBeUnknown();
		expectTypeOf<ReturnType<(typeof replies)[404]["parse"]>>().toEqualTypeOf<{
			errorCode: "sale_not_found";
			errorMessage: string;
		}>();
		expectTypeOf<ReturnType<(typeof replies)[409]["parse"]>>().toEqualTypeOf<{
			errorCode: "sold_out";
			errorMessage: string;
		}>();
	});
});

describe("errorBody", () => {
	it("accepts only the listed codes and no other field shape", () => {
		const schema = errorBody(["sold_out"]);
		expect(schema.safeParse(errorPayload("sold_out")).success).toBe(true);
		expect(
			schema.safeParse({ errorCode: "other", errorMessage: "x" }).success,
		).toBe(false);
		expect(schema.safeParse({ errorCode: "sold_out" }).success).toBe(false);
		expect(schema.safeParse({ error: "sold_out" }).success).toBe(false);
		expect(schema.safeParse("sold_out").success).toBe(false);
	});
});

describe("ErrorBody", () => {
	it("accepts any code of the API", () => {
		expect(ErrorBody.safeParse(errorPayload("not_found")).success).toBe(true);
		expect(
			ErrorBody.safeParse({ errorCode: "nope", errorMessage: "x" }).success,
		).toBe(false);
	});
});

describe("the views", () => {
	const sale = {
		id: "0f8fad5b-d9cb-469f-a165-70867728950e",
		name: "Drop",
		status: "active",
		startsAt: "2026-01-01T00:00:00.000Z",
		endsAt: "2026-01-01T01:00:00.000Z",
		stock: 3,
		remaining: 2,
	};

	it("reads a sale", () => {
		expect(SaleView.safeParse(sale).success).toBe(true);
		expect(SaleView.safeParse({ ...sale, status: "paused" }).success).toBe(
			false,
		);
		expect(SaleView.safeParse({ ...sale, startsAt: "yesterday" }).success).toBe(
			false,
		);
	});

	it("reads each state of a place and of a join", () => {
		expect(
			PlaceView.safeParse({ userId: "a", state: "waiting", place: 3 }).success,
		).toBe(true);
		expect(PlaceView.safeParse({ userId: "a", state: "waiting" }).success).toBe(
			false,
		);
		expect(
			JoinedView.safeParse({ userId: "a", ticket: "t", state: "admitted" })
				.success,
		).toBe(true);
		expect(
			JoinedView.safeParse({ userId: "a", state: "admitted" }).success,
		).toBe(false);
	});

	it("reads the three outcomes", () => {
		const base = { userId: "a" };
		expect(OutcomeView.safeParse({ ...base, state: "none" }).success).toBe(
			true,
		);
		expect(
			OutcomeView.safeParse({
				...base,
				state: "holding",
				reservationId: "r",
				expiresAt: "2026-01-01T00:00:00.000Z",
			}).success,
		).toBe(true);
		expect(OutcomeView.safeParse({ ...base, state: "purchased" }).success).toBe(
			false,
		);
	});

	it("tells ready from not ready", () => {
		expect(
			ReadyView.safeParse({
				status: "ok",
				checks: { database: "ok", redis: "ok" },
			}).success,
		).toBe(true);
		expect(
			ReadyView.safeParse({
				status: "unavailable",
				checks: { database: "ok", redis: "error" },
			}).success,
		).toBe(true);
		expect(
			ReadyView.safeParse({
				status: "ok",
				checks: { database: "ok", redis: "error" },
			}).success,
		).toBe(false);
	});
});
