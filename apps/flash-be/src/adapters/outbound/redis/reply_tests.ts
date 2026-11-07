// Plain Vitest tests for the reply helpers the Redis adapters share: a list reply is read as a list, and anything else is the
// one shared failure. The replies below stand for what Redis answers to a script.

import { Err, Ok } from "@flash/typekit";
import { describe, expect, it } from "vitest";
import { arrayReply, UNREADABLE } from "./reply.js";

describe("arrayReply", () => {
	it("reads a list reply as the list it is", () => {
		const reply = arrayReply([1, "two"]);
		expect(reply).toEqual(new Ok([1, "two"]));
	});

	it("reads an empty list as an empty list, not as a failure", () => {
		expect(arrayReply([])).toEqual(new Ok([]));
	});

	it.each([undefined, null, 1, "text", { code: 1 }])(
		"refuses the reply %j, which is not a list, with the shared failure",
		(reply) => {
			expect(arrayReply(reply)).toEqual(new Err(UNREADABLE));
		},
	);

	it("names the failure as the unreadable reply", () => {
		expect(UNREADABLE).toBe("unreadable_reply");
	});
});
