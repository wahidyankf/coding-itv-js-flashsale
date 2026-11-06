import { describe, expect, expectTypeOf, it } from "vitest";
import { Err, Ok, type Result } from "./result.js";

const good: Result<number, string> = new Ok(2);
const bad: Result<number, string> = new Err("bad");

describe("Result guards and discriminant", () => {
	it("tells the sides apart by method and by tag", () => {
		expect(good.isOk()).toBe(true);
		expect(good.isErr()).toBe(false);
		expect(bad.isOk()).toBe(false);
		expect(bad.isErr()).toBe(true);
		expect(good._tag).toBe("ok");
		expect(bad._tag).toBe("err");
	});

	it("narrows with the guards and with a switch on the tag", () => {
		if (good.isOk()) expectTypeOf(good.value).toEqualTypeOf<number>();
		if (bad.isErr()) expectTypeOf(bad.error).toEqualTypeOf<string>();
		const read = (outcome: Result<number, string>): string => {
			switch (outcome._tag) {
				case "ok":
					return `value ${outcome.value}`;
				case "err":
					return `error ${outcome.error}`;
			}
		};
		expect(read(good)).toBe("value 2");
		expect(read(bad)).toBe("error bad");
	});
});

describe("types", () => {
	it("keeps the value and fault types through a chain", () => {
		const chained = good.map(String).mapErr(Number);
		expectTypeOf(chained).toEqualTypeOf<Result<string, number>>();
		const widened = good.flatMap((n) => (n > 0 ? new Ok(n) : new Err(false)));
		expectTypeOf(widened).toEqualTypeOf<Result<number, string | boolean>>();
	});

	it("builds an Ok or an Err without naming the other side", () => {
		const ok: Result<number, string> = new Ok(1);
		const err: Result<number, string> = new Err("x");
		expect(ok.isOk()).toBe(true);
		expect(err.isErr()).toBe(true);
	});
});
