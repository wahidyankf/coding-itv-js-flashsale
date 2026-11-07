import { describe, expect, it } from "vitest";
import { failureMessage } from "./failure-message.js";

describe("failureMessage", () => {
	it("prints the message of an ordinary failure", () => {
		expect(failureMessage(new Error("the sale is not valid"))).toBe(
			"the sale is not valid",
		);
	});

	// pg raises an AggregateError with an empty message when no address of the database answers. The reasons are inside.
	it("prints the reasons of a connection failure, which has no message of its own", () => {
		const failure = new AggregateError(
			[
				new Error("connect ECONNREFUSED 127.0.0.1:5432"),
				new Error("connect ECONNREFUSED ::1:5432"),
			],
			"",
		);
		expect(failureMessage(failure)).toBe(
			"cannot reach the database: connect ECONNREFUSED 127.0.0.1:5432; connect ECONNREFUSED ::1:5432",
		);
	});

	it("prints a reason that is not an error as plain text", () => {
		expect(failureMessage(new AggregateError(["refused"], ""))).toBe(
			"cannot reach the database: refused",
		);
	});

	it("says the database cannot be reached when a connection failure gives no reason", () => {
		expect(failureMessage(new AggregateError([], ""))).toBe(
			"cannot reach the database",
		);
	});

	it("keeps the message of an aggregate that has one", () => {
		const failure = new AggregateError([new Error("inner")], "all failed");
		expect(failureMessage(failure)).toBe("all failed");
	});
});
