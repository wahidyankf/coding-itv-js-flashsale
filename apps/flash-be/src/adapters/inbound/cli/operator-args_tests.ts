// Unit tests for the operator command's input: the refusals and the words each one prints, and the flags it reads.
import { Err, Ok } from "@flash/typekit";
import { describe, expect, it } from "vitest";
import { normalizeUser } from "../../../domain/user.js";
import {
	operatorInputOf,
	parseOperatorArgs,
	refusalMessage,
} from "./operator-args.js";

describe("operatorInputOf", () => {
	// These run before the database is touched, so a bad argument is not reported as a database failure.
	it("refuses a missing or unusable name", () => {
		expect(
			operatorInputOf({ username: undefined, password: "a long phrase" }),
		).toEqual(new Err("invalid_user"));
		expect(
			operatorInputOf({ username: "  ", password: "a long phrase" }),
		).toEqual(new Err("invalid_user"));
	});

	it("refuses a password outside the length rules, or none", () => {
		expect(operatorInputOf({ username: "ana", password: "short" })).toEqual(
			new Err("invalid_password"),
		);
		expect(operatorInputOf({ username: "ana", password: undefined })).toEqual(
			new Err("invalid_password"),
		);
	});

	it("gives the use case the name in its usable form, and the password as it was given", () => {
		expect(
			operatorInputOf({ username: "Ana", password: "a long phrase" }),
		).toEqual(new Ok({ username: "ana", password: "a long phrase" }));
	});
});

describe("refusalMessage", () => {
	it("says what the command needed for each refusal", () => {
		expect(refusalMessage("invalid_user", undefined)).toBe(
			"--username is missing or not a valid name",
		);
		expect(refusalMessage("invalid_password", undefined)).toBe(
			"--password must have 8 to 128 characters",
		);
	});

	it("names the user who already exists, in the form it is stored", () => {
		expect(refusalMessage("username_taken", normalizeUser(" Ana "))).toBe(
			"the user ana already exists",
		);
	});
});

// A bad flag is a message to print, not an exception: the parser answers with the usage error.
describe("parseOperatorArgs", () => {
	it("reads both flags, with a space or with =", () => {
		expect(
			parseOperatorArgs(["--username", "ana", "--password", "a long phrase"]),
		).toEqual(
			new Ok({
				username: "ana",
				password: "a long phrase",
			}),
		);
		expect(
			parseOperatorArgs(["--username=ana", "--password=a long phrase"]),
		).toEqual(
			new Ok({
				username: "ana",
				password: "a long phrase",
			}),
		);
	});

	it("leaves a flag that was not given undefined", () => {
		expect(parseOperatorArgs([])).toEqual(
			new Ok({
				username: undefined,
				password: undefined,
			}),
		);
	});

	it("refuses a flag the command does not have", () => {
		expect(parseOperatorArgs(["--role", "operator"]).isErr()).toBe(true);
	});
});
