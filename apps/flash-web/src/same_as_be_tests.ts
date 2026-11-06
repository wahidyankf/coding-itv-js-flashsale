import { describe, expect, it, vi } from "vitest";
import {
	ERROR_STATUS,
	errorPayload,
} from "../../flash-be/src/adapters/inbound/http/errors";
import { isSaleId } from "../../flash-be/src/domain/sale";
import { normalizeUser } from "../../flash-be/src/domain/user";
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

	it("keeps its own code, which flash-be never sends, apart from the codes of flash-be", () => {
		expect(Object.keys(ERROR_STATUS)).not.toContain("backend_unavailable");
	});
});
