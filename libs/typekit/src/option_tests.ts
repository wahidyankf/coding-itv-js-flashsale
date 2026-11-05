import { describe, expect, expectTypeOf, it } from "vitest";
import * as option from "./option.js";
import { fromOptional, type Option, Some } from "./option.js";

describe("Option", () => {
	it("keeps null as a present value", () => {
		expect(fromOptional<null>(null)).toEqual(new Some(null));
	});

	it("is frozen like Ok", () => {
		const some = new Some(1);
		expect(Object.isFrozen(some)).toBe(true);
		expect(some._tag).toBe("some");
	});

	it("matches both sides through the curried match", () => {
		const run = option.match({ some: (n: number) => n * 2, none: () => -1 });
		expect(run(new Some(4))).toBe(8);
		expect(run(undefined)).toBe(-1);
	});

	it("infers the value type through a chain", () => {
		const found: Option<number> = new Some(1);
		const next = option.map((n: number) => String(n))(found);
		expectTypeOf(next).toEqualTypeOf<Option<string>>();
	});

	it("is covariant in its value", () => {
		expectTypeOf<Some<boolean>>().toExtend<Some<number | boolean>>();
	});
});
