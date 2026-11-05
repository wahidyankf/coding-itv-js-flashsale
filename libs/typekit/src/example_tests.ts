import { describe, expect, it } from "vitest";
import { attempt, pipe, result } from "./index.js";

// The example in README.md, kept here so it is type-checked and run.
describe("README example", () => {
	const parse = (text: string) =>
		attempt(() => JSON.parse(text) as number, SyntaxError);

	it("doubles a number read from text", () => {
		const doubled = pipe(
			parse("21"),
			result.map((n: number) => n * 2),
		);
		const shown = doubled.match({
			ok: (n) => `ok ${n}`,
			err: (error) => error.message,
		});
		expect(shown).toBe("ok 42");
	});

	it("keeps the syntax error of bad text as a value", () => {
		const doubled = pipe(
			parse("{"),
			result.map((n: number) => n * 2),
		);
		expect(doubled.isErr()).toBe(true);
	});
});
