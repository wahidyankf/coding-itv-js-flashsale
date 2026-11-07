// Unit tests for how the Redis queue store reads the replies of its scripts. A reply the scripts do not write is a failure
// value, so the service can treat the line as lost. The scripts themselves run in Redis (integration tests).
import { Err, Ok } from "@flash/typekit";
import { describe, expect, it } from "vitest";
import { joinReplyOf, placeReplyOf, usersOf } from "./redis-queue-store.js";

describe("the reply of the join script", () => {
	it("reads a new place and a place already waiting, with the place's number", () => {
		expect(joinReplyOf([0, 1])).toEqual(
			new Ok({ place: { state: "waiting", place: 1 }, created: true }),
		);
		expect(joinReplyOf([1, 3])).toEqual(
			new Ok({ place: { state: "waiting", place: 3 }, created: false }),
		);
	});

	it("reads an admitted shopper as admitted, with no new place", () => {
		expect(joinReplyOf([2, 0])).toEqual(
			new Ok({ place: { state: "admitted" }, created: false }),
		);
	});

	it.each([
		["an unknown code", [7, 0]],
		["no code", []],
		["a reply that is not a list", "joined"],
		["a number that is not a place", [1, "two"]],
	])("refuses %s as unreadable", (_name, reply) => {
		expect(joinReplyOf(reply)).toEqual(new Err("unreadable_reply"));
	});
});

describe("the reply of the place script", () => {
	it("reads a waiting, admitted and absent shopper", () => {
		expect(placeReplyOf([1, 2])).toEqual(
			new Ok({ state: "waiting", place: 2 }),
		);
		expect(placeReplyOf([2, 0])).toEqual(new Ok({ state: "admitted" }));
		expect(placeReplyOf([3, 0])).toEqual(new Ok({ state: "absent" }));
	});

	// The place script never adds a shopper, so its reply has no "new place" code.
	it.each([
		["the code of a new place, which only the join writes", [0, 1]],
		["an unknown code", [9, 0]],
	])("refuses %s as unreadable", (_name, reply) => {
		expect(placeReplyOf(reply)).toEqual(new Err("unreadable_reply"));
	});
});

describe("the reply of the admit script", () => {
	it("reads the names of the shoppers it admitted", () => {
		expect(usersOf(["ana", "ben"])).toEqual(new Ok(["ana", "ben"]));
		expect(usersOf([])).toEqual(new Ok([]));
	});

	it.each([
		["a name that is not text", [1]],
		["a reply that is not a list", "ana"],
	])("refuses %s as unreadable", (_name, reply) => {
		expect(usersOf(reply)).toEqual(new Err("unreadable_reply"));
	});
});
