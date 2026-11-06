import { describe, expect, it } from "vitest";
import { attempt } from "./index.js";

// The example in README.md, kept here so it is type-checked and run.
describe("README example", () => {
	const parse = (text: string) =>
		attempt(() => JSON.parse(text) as number, SyntaxError);

	it("reads a number and answers with its double", () => {
		const shown = parse("21").match({
			ok: (n) => `ok ${n * 2}`,
			err: (error) => error.message,
		});
		expect(shown).toBe("ok 42");
	});

	it("keeps the syntax error of bad text as a value", () => {
		expect(parse("{").isErr()).toBe(true);
	});
});
