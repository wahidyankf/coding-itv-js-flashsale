import { describe, expect, it } from "vitest";
import { parseReply } from "./reply.js";
import { routes } from "./routes.js";
import {
	CLIENT_FAILURE_MESSAGE,
	ERROR_MESSAGE,
	errorPayload,
} from "./vocabulary.js";

const sale = {
	id: "s1",
	name: "Drop",
	status: "active",
	startsAt: "2026-01-01T00:00:00.000Z",
	endsAt: "2026-01-01T01:00:00.000Z",
	stock: 3,
	remaining: 2,
};
const reply = (
	status: number,
	body: unknown,
	headers: Record<string, string> = {},
) => ({
	status,
	headers,
	text: typeof body === "string" ? body : JSON.stringify(body),
});

describe("parseReply", () => {
	it("returns the status and body of a declared reply", () => {
		const result = parseReply(routes.sale, reply(200, sale));
		expect(result.isOk() && result.value).toEqual({ status: 200, body: sale });
	});

	it("returns a declared reply that is not an error, even with a 5xx status", () => {
		const down = {
			status: "unavailable",
			checks: { database: "ok", redis: "error" },
		};
		const result = parseReply(routes.ready, reply(503, down));
		expect(result.isOk() && result.value.status).toBe(503);
	});

	it("names a refusal by its code and status", () => {
		const result = parseReply(
			routes.sale,
			reply(404, errorPayload("sale_not_found")),
		);
		expect(result.isErr() && result.error).toEqual({
			errorCode: "sale_not_found",
			errorMessage: ERROR_MESSAGE.sale_not_found,
			status: 404,
			retryAfterSeconds: undefined,
		});
	});

	it("reads how long to wait from the header, whatever its case", () => {
		const result = parseReply(
			routes.reserve,
			reply(
				429,
				{ ...errorPayload("rate_limited"), retryAfterSeconds: 9 },
				{ "Retry-After": "3" },
			),
		);
		expect(result.isErr() && result.error.retryAfterSeconds).toBe(3);
	});

	it("reads how long to wait from the body when there is no header", () => {
		const result = parseReply(
			routes.reserve,
			reply(429, { ...errorPayload("rate_limited"), retryAfterSeconds: 9 }),
		);
		expect(result.isErr() && result.error.retryAfterSeconds).toBe(9);
	});

	it("gives no wait time when neither the header nor the body has a number", () => {
		const headerOnly = parseReply(
			routes.reserve,
			reply(
				429,
				{ ...errorPayload("rate_limited"), retryAfterSeconds: 1 },
				{ "content-type": "application/json" },
			),
		);
		expect(headerOnly.isErr() && headerOnly.error.retryAfterSeconds).toBe(1);
		const refused = parseReply(
			routes.sale,
			reply(404, {
				...errorPayload("sale_not_found"),
				retryAfterSeconds: "soon",
			}),
		);
		expect(refused.isErr() && refused.error.retryAfterSeconds).toBeUndefined();
	});

	it("accepts a refusal that the edge of the server sends, which no route lists", () => {
		const result = parseReply(
			routes.sale,
			reply(404, errorPayload("not_found")),
		);
		expect(result.isErr() && result.error.errorCode).toBe("not_found");
		const broken = parseReply(
			routes.joinQueue,
			reply(400, errorPayload("invalid_request")),
		);
		expect(broken.isErr() && broken.error.errorCode).toBe("invalid_request");
	});

	it("calls a reply that breaks the contract unexpected", () => {
		const cases = [
			reply(200, "not json"),
			reply(200, { ...sale, status: "paused" }),
			reply(202, sale),
			reply(409, errorPayload("sale_not_found")),
			reply(404, { error: "sale_not_found" }),
			reply(404, { errorCode: "sale_not_found" }),
			reply(500, { message: "boom" }),
		];
		for (const raw of cases) {
			const result = parseReply(routes.sale, raw);
			expect(result.isErr() && result.error.errorCode).toBe("unexpected");
			expect(result.isErr() && result.error.errorMessage).toBe(
				CLIENT_FAILURE_MESSAGE.unexpected,
			);
			expect(result.isErr() && result.error.status).toBe(raw.status);
		}
	});
});
