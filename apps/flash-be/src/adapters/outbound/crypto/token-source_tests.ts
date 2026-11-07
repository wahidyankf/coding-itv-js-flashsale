import { describe, expect, it } from "vitest";
import { randomTokenSource } from "./token-source.js";

describe("randomTokenSource", () => {
	it("makes a different token each time, 32 random bytes in base64url", () => {
		const first = randomTokenSource();
		expect(first).not.toBe(randomTokenSource());
		expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/);
	});
});
