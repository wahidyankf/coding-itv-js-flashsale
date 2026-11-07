// Unit tests for who may reserve, as the queue's place and the purchase record decide it. Pure: no store is read here.
import { describe, expect, it } from "vitest";
import { reserveRefusalOf } from "./queue.js";

describe("who may reserve", () => {
	it("lets an admitted shopper reserve", () => {
		expect(reserveRefusalOf({ state: "admitted" }, false)).toBeUndefined();
	});

	it("keeps a waiting shopper out until they are admitted", () => {
		expect(reserveRefusalOf({ state: "waiting", place: 4 }, false)).toBe(
			"not_admitted",
		);
	});

	// A shopper outside the line is told they bought, when the purchase record says so, because the line can be lost.
	it("tells a shopper outside the line whether they already bought", () => {
		expect(reserveRefusalOf(undefined, true)).toBe("already_purchased");
		expect(reserveRefusalOf(undefined, false)).toBe("not_admitted");
	});
});
