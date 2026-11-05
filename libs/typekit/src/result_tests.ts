import { describe, expect, expectTypeOf, it } from "vitest";
import * as result from "./result.js";
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

describe("curried combinators", () => {
	it("map and mapErr act on their own side", () => {
		expect(result.map((n: number) => n + 1)(good)).toEqual(new Ok(3));
		expect(result.map((n: number) => n + 1)(bad)).toEqual(new Err("bad"));
		expect(result.mapErr((e: string) => e.length)(bad)).toEqual(new Err(3));
		expect(result.mapErr((e: string) => e.length)(good)).toEqual(new Ok(2));
	});

	it("flatMap and flatMapErr continue with a step that may fail", () => {
		const half = (n: number): Result<number, string> =>
			n % 2 === 0 ? new Ok(n / 2) : new Err("odd");
		expect(result.flatMap(half)(good)).toEqual(new Ok(1));
		expect(result.flatMap(half)(bad)).toEqual(new Err("bad"));
		const recover = (): Result<number, string> => new Ok(0);
		expect(result.flatMapErr(recover)(bad)).toEqual(new Ok(0));
		expect(result.flatMapErr(recover)(good)).toEqual(new Ok(2));
	});

	it("tap and tapErr see one side and return the result", () => {
		const seen: unknown[] = [];
		expect(result.tap((n: number) => seen.push(n))(good)).toBe(good);
		expect(result.tapErr((e: string) => seen.push(e))(bad)).toBe(bad);
		expect(seen).toEqual([2, "bad"]);
	});

	it("match picks the handler of the side", () => {
		const run = result.match({
			ok: (n: number) => n,
			err: (e: string) => e.length,
		});
		expect(run(good)).toBe(2);
		expect(run(bad)).toBe(3);
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
