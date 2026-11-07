import { describe, expect, it } from "vitest";
import {
	operatorArgsRefusal,
	parseOperatorArgs,
	refusalMessage,
} from "./operator-args.js";

describe("operatorArgsRefusal", () => {
	// These run before the database is touched, so a bad argument is not reported as a database failure.
	it("refuses a missing or unusable name", () => {
		expect(
			operatorArgsRefusal({ username: undefined, password: "a long phrase" }),
		).toBe("invalid_user");
		expect(
			operatorArgsRefusal({ username: "  ", password: "a long phrase" }),
		).toBe("invalid_user");
	});

	it("refuses a password outside the length rules, or none", () => {
		expect(operatorArgsRefusal({ username: "ana", password: "short" })).toBe(
			"invalid_password",
		);
		expect(operatorArgsRefusal({ username: "ana", password: undefined })).toBe(
			"invalid_password",
		);
	});

	it("lets well-formed arguments through", () => {
		expect(
			operatorArgsRefusal({ username: "Ana", password: "a long phrase" }),
		).toBeUndefined();
	});
});

describe("refusalMessage", () => {
	it("says what the command needed for each refusal", () => {
		expect(refusalMessage("invalid_user", undefined)).toBe(
			"--username is missing or not a valid name",
		);
		expect(refusalMessage("invalid_password", "ana")).toBe(
			"--password must have 8 to 128 characters",
		);
	});

	it("names the user who already exists, in the form it is stored", () => {
		expect(refusalMessage("username_taken", " Ana ")).toBe(
			"the user ana already exists",
		);
	});
});

describe("parseOperatorArgs", () => {
	it("reads both flags, with a space or with =", () => {
		expect(
			parseOperatorArgs(["--username", "ana", "--password", "a long phrase"]),
		).toEqual({
			username: "ana",
			password: "a long phrase",
		});
		expect(
			parseOperatorArgs(["--username=ana", "--password=a long phrase"]),
		).toEqual({
			username: "ana",
			password: "a long phrase",
		});
	});

	it("leaves a flag that was not given undefined", () => {
		expect(parseOperatorArgs([])).toEqual({
			username: undefined,
			password: undefined,
		});
	});

	it("refuses a flag the command does not have", () => {
		expect(() => parseOperatorArgs(["--role", "operator"])).toThrow();
	});
});
