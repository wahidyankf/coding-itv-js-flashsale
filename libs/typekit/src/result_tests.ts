// Unit tests for Result: the guards, the types, map and mapErr, match, and the rule that a Result cannot be changed.
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

	it("lets an Ok or an Err stand for a wider Result (covariance)", () => {
		expectTypeOf<Ok<boolean>>().toExtend<Ok<number | boolean>>();
		expectTypeOf<Ok<number>>().toExtend<Result<number, string>>();
		expectTypeOf<Err<never, string>>().toExtend<Result<number, string>>();
	});
});

describe("map and mapErr", () => {
	it("changes the value of an Ok and leaves an Err alone", () => {
		expect(good.map((n) => n * 2)).toEqual(new Ok(4));
		expect(bad.map((n) => n * 2)).toEqual(new Err("bad"));
	});

	it("changes the fault of an Err and leaves an Ok alone", () => {
		expect(bad.mapErr((e) => e.toUpperCase())).toEqual(new Err("BAD"));
		expect(good.mapErr((e) => e.toUpperCase())).toEqual(new Ok(2));
	});
});

describe("match", () => {
	const handlers = {
		ok: (n: number) => `ok ${n}`,
		err: (e: string) => `err ${e}`,
	};

	it("runs the handler of its side", () => {
		expect(good.match(handlers)).toBe("ok 2");
		expect(bad.match(handlers)).toBe("err bad");
	});

	it("refuses a match without a handler for one side", () => {
		const run = () => [
			// @ts-expect-error the err handler is missing
			good.match({ ok: (n: number) => n }),
		];
		// The @ts-expect-error above fails `tsc` when the call becomes valid.
		expect(typeof run).toBe("function");
	});
});

describe("immutability", () => {
	it("refuses an assignment to a field, and the field stays as it was", () => {
		const ok: Ok<number> = new Ok(2);
		const err: Err<never, string> = new Err("bad");

		expect(() => {
			// @ts-expect-error value is readonly
			ok.value = 3;
		}).toThrow(TypeError);
		expect(() => {
			// @ts-expect-error error is readonly
			err.error = "worse";
		}).toThrow(TypeError);

		expect(ok.value).toBe(2);
		expect(err.error).toBe("bad");
	});
});
