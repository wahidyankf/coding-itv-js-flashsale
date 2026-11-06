import { describe, expect, expectTypeOf, it } from "vitest";
import { Err, Ok, type Result } from "./result.js";

const good: Result<number, string> = new Ok(2);
const bad: Result<number, string> = new Err("bad");

describe("Result guards", () => {
	it("tells the sides apart by method", () => {
		expect(good.isOk()).toBe(true);
		expect(good.isErr()).toBe(false);
		expect(bad.isOk()).toBe(false);
		expect(bad.isErr()).toBe(true);
	});

	it("narrows with the guards", () => {
		if (good.isOk()) expectTypeOf(good.value).toEqualTypeOf<number>();
		if (bad.isErr()) expectTypeOf(bad.error).toEqualTypeOf<string>();
	});
});

describe("types", () => {
	it("keeps the value and fault types through a chain", () => {
		const chained = good.map(String).mapErr(Number);
		expectTypeOf(chained).toEqualTypeOf<Result<string, number>>();
	});

	it("builds an Ok or an Err without naming the other side", () => {
		const ok: Result<number, string> = new Ok(1);
		const err: Result<number, string> = new Err("x");
		expect(ok.isOk()).toBe(true);
		expect(err.isErr()).toBe(true);
	});
});
