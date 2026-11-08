// Checks that flash-web's copies of flash-be's rules still agree with flash-be.
import { describe, expect, it, vi } from "vitest";
import {
	ERROR_STATUS,
	errorPayload,
} from "../../flash-be/src/adapters/inbound/http/errors";
import { TICKET_HEADER as BACKEND_TICKET_HEADER } from "../../flash-be/src/adapters/inbound/http/headers";
import { usablePassword } from "../../flash-be/src/domain/auth";
import { normalizeUser } from "../../flash-be/src/domain/user";
import { TICKET_HEADER } from "./api";
import { cleanPassword, cleanUser } from "./auth/messages";
import { proxyToBackend } from "./proxy";

// flash-web copies a few flash-be rules: the user name and password checks, the queue-ticket header and the proxy's error
// replies. Each copy is used only by flash-web (docs/explanation/decisions/016-dry-rule-of-three.md).
// These tests are the guard: when flash-be changes one, the copy here must change too.
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

	it("names the queue-ticket header as flash-be does", () => {
		expect(TICKET_HEADER).toBe(BACKEND_TICKET_HEADER);
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
