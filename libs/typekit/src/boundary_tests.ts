import { describe, expect, expectTypeOf, it } from "vitest";
import { attempt, attemptAsync } from "./boundary.js";
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

	it("returns the value of a call that does not throw", () => {
		const outcome = attempt(() => 1, Error);
		expectTypeOf(outcome).toEqualTypeOf<Result<number, Error>>();
		expect(outcome).toEqual(new Ok(1));
	});

	it("returns an Err holding the same exception", () => {
		const thrown = new NotFound("gone");
		const outcome = attempt(() => {
			throw thrown;
		}, NotFound);
		expect(outcome.isErr() && outcome.error).toBe(thrown);
	});

	it("lets an exception of another type through unchanged", () => {
		const thrown = new TypeError("wrong type");
		expect(() =>
			attempt(() => {
				throw thrown;
			}, NotFound),
		).toThrow(thrown);
	});

	it("refuses a call with no guard, at run time as well as in the types", () => {
		expect(() => {
			// @ts-expect-error at least one guard must be named
			attempt(() => 1);
		}).toThrow(TypeError);
	});
});

describe("attemptAsync with guards", () => {
	it("needs at least one guard", async () => {
		await expect(
			// @ts-expect-error at least one guard must be named
			attemptAsync(async () => 1),
		).rejects.toThrow(TypeError);
	});

	it("catches a rejection of the named class", async () => {
		const outcome = await attemptAsync(
			() => Promise.reject(new NotFound("x")),
			NotFound,
		);
		expect(outcome.isErr()).toBe(true);
	});

	it("returns Ok with the value a promise resolves to", async () => {
		expect(await attemptAsync(async () => 7, Error)).toEqual(new Ok(7));
	});

	it("returns an Err holding the same rejection", async () => {
		const thrown = new RangeError("out of range");
		const outcome = await attemptAsync(
			() => Promise.reject(thrown),
			RangeError,
		);
		expect(outcome.isErr() && outcome.error).toBe(thrown);
	});

	it("lets a rejection of another type through", async () => {
		const thrown = new TypeError("wrong type");
		await expect(
			attemptAsync(() => Promise.reject(thrown), RangeError),
		).rejects.toBe(thrown);
	});

	it("catches a call that throws before it returns a promise", async () => {
		const thrown = new RangeError("at once");
		const outcome = await attemptAsync(() => {
			throw thrown;
		}, RangeError);
		expect(outcome.isErr() && outcome.error).toBe(thrown);
	});
});
