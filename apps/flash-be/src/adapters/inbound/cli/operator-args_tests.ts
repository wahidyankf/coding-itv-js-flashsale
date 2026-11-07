import { describe, expect, it } from "vitest";
import { parseOperatorArgs } from "./operator-args.js";

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
