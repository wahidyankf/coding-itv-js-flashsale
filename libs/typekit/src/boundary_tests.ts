import { describe, expect, expectTypeOf, it } from "vitest";
import { attempt, attemptAsync, satisfying } from "./boundary.js";
import { Err, Ok, type Result } from "./result.js";

class NotFound extends Error {}
class Denied extends Error {}

describe("attempt with several guards", () => {
	it("catches any of the named types and types the fault as their union", () => {
		const outcome = attempt(
			() => {
				throw new Denied("no");
			},
			NotFound,
			Denied,
		);
		expectTypeOf(outcome).toEqualTypeOf<Result<never, NotFound | Denied>>();
		expect(outcome).toEqual(new Err(new Denied("no")));
	});

	it("catches a subclass of the named type", () => {
		const outcome = attempt(() => {
			throw new NotFound("gone");
		}, Error);
		expect(outcome.isErr()).toBe(true);
	});

	it("does not catch a thrown value no guard accepts", () => {
		expect(() =>
			attempt(() => {
				throw "plain";
			}, Error),
		).toThrow("plain");
	});

	it("types a predicate guard by what it accepts", () => {
		const isCode = (thrown: unknown): thrown is number =>
			typeof thrown === "number";
		const outcome = attempt(() => 1, satisfying(isCode));
		expectTypeOf(outcome).toEqualTypeOf<Result<number, number>>();
		expect(outcome).toEqual(new Ok(1));
	});
});

describe("attemptAsync with guards", () => {
	it("needs at least one guard", async () => {
		await expect(
			// @ts-expect-error at least one guard must be named
			attemptAsync(async () => 1),
		).rejects.toThrow(TypeError);
	});

	it("catches a predicate-guarded rejection", async () => {
		const outcome = await attemptAsync(
			() => Promise.reject("plain"),
			satisfying((thrown): thrown is string => typeof thrown === "string"),
		);
		expect(outcome).toEqual(new Err("plain"));
	});
});
