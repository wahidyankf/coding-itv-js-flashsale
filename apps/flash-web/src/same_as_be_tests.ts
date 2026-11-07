import { describe, expect, it, vi } from "vitest";
import {
	ERROR_STATUS,
	errorPayload,
} from "../../flash-be/src/adapters/inbound/http/errors";
import { usablePassword } from "../../flash-be/src/domain/auth";
import { isSaleId } from "../../flash-be/src/domain/sale";
import { normalizeUser } from "../../flash-be/src/domain/user";
import { cleanPassword } from "./auth/messages";
import { isAllowed, proxyToBackend } from "./proxy";
import { cleanUser } from "./sale/messages";

// flash-web keeps its own copy of a few rules and sentences of flash-be, so the two apps share no library. These tests
// are the guard: when flash-be changes one of them, the copy here must change too.
describe("what flash-web copies from flash-be", () => {
	it.each([
		"ana",
		"  Ana ",
		"A.b_c@d+e-f",
		"a".repeat(64),
		"a".repeat(65),
		"",
		"   ",
		".ana",
		"an a",
		"ana!",
	])("reads the user name %j as flash-be does", (raw) => {
		expect(cleanUser(raw)).toBe(normalizeUser(raw));
	});

	it.each([
		"",
		"short",
		"1234567",
		"12345678",
		"a long pass phrase",
		"x".repeat(128),
		"x".repeat(129),
	])("reads the password %j as flash-be does", (raw) => {
		expect(cleanPassword(raw)).toBe(usablePassword(raw));
	});

	it.each([
		"0f8fad5b-d9cb-469f-a165-70867728950e",
		"0F8FAD5B-D9CB-469F-A165-70867728950E",
		"not-a-uuid",
		"0f8fad5b-d9cb-469f-a165-70867728950",
		"",
	])("passes the sale id %j on only when flash-be accepts it", (saleId) => {
		expect(isAllowed("GET", `/sales/${saleId}`)).toBe(isSaleId(saleId));
	});

	it("answers an unknown path with the code, status and sentence of flash-be", async () => {
		const reply = await proxyToBackend(
			new Request("http://web.test/api/nope"),
			{ FLASH_BE_URL: "http://be.test" },
			vi.fn<typeof fetch>(),
		);
		expect(reply.status).toBe(ERROR_STATUS.not_found);
		expect(await reply.json()).toEqual(errorPayload("not_found"));
	});

	it.each(["backend_unavailable", "cross_site"])(
		"keeps its own code %s, which flash-be never sends, apart from the codes of flash-be",
		(code) => {
			expect(Object.keys(ERROR_STATUS)).not.toContain(code);
		},
	);

	it("answers a request from another site with 403, the status flash-be gives to a forbidden account", async () => {
		const reply = await proxyToBackend(
			new Request("http://web.test/api/auth/login", {
				method: "POST",
				body: "{}",
				headers: { origin: "http://evil.test" },
			}),
			{ FLASH_BE_URL: "http://be.test" },
			vi.fn<typeof fetch>(),
		);
		expect(reply.status).toBe(ERROR_STATUS.forbidden);
	});
});
