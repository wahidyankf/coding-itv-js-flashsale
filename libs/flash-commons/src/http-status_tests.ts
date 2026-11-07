// Plain Vitest tests for the HTTP status numbers. The numbers are the standard ones, so the literals below are the expected values.
import { describe, expect, it } from "vitest";
import {
	FIRST_ERROR_STATUS,
	FIRST_SERVER_ERROR_STATUS,
	HTTP_STATUS,
} from "./http-status.js";

describe("HTTP_STATUS", () => {
	it("names the standard status numbers", () => {
		expect(HTTP_STATUS).toEqual({
			ok: 200,
			created: 201,
			badRequest: 400,
			unauthorized: 401,
			paymentRequired: 402,
			forbidden: 403,
			notFound: 404,
			conflict: 409,
			tooManyRequests: 429,
			internalServerError: 500,
			badGateway: 502,
			serviceUnavailable: 503,
		});
	});
});

describe("the first error statuses", () => {
	it("starts the client errors at 400 and the server errors at 500", () => {
		expect(FIRST_ERROR_STATUS).toBe(400);
		expect(FIRST_SERVER_ERROR_STATUS).toBe(500);
	});

	it("are the statuses that HTTP_STATUS names for them", () => {
		expect(FIRST_ERROR_STATUS).toBe(HTTP_STATUS.badRequest);
		expect(FIRST_SERVER_ERROR_STATUS).toBe(HTTP_STATUS.internalServerError);
	});
});
