import { describeFeature, loadFeature } from "@amiceli/vitest-cucumber";
import { expect } from "vitest";
import { attempt, attemptAsync } from "../boundary.js";
import { Err, Ok } from "../result.js";
import { specFile } from "./support/paths.js";

describeFeature(
	await loadFeature(specFile("typekit/attempt/attempting.feature")),
	({ Scenario }) => {
		Scenario(
			"Attempt returns Ok with the value of a call that does not throw",
			({ Given, When, Then }) => {
				let call: () => number = () => 0;
				let outcome: unknown;

				Given("a call that returns 7", () => {
					call = () => 7;
				});
				When("it is attempted with the guard Error", () => {
					outcome = attempt(call, Error);
				});
				Then("the result is an Ok holding 7", () => {
					expect(outcome).toEqual(new Ok(7));
				});
			},
		);

		Scenario(
			"Attempt returns Err with an exception of a named type",
			({ Given, When, Then }) => {
				const thrown = new RangeError("out of range");
				let call: () => number = () => 0;
				let outcome: unknown;

				Given("a call that throws a RangeError", () => {
					call = () => {
						throw thrown;
					};
				});
				When("it is attempted with the guard RangeError", () => {
					outcome = attempt(call, RangeError);
				});
				Then("the result is an Err holding that same exception", () => {
					expect(outcome).toEqual(new Err(thrown));
					expect((outcome as Err<never, RangeError>).error).toBe(thrown);
				});
			},
		);

		Scenario(
			"Attempt lets an exception of another type through",
			({ Given, When, Then }) => {
				const thrown = new TypeError("wrong type");
				let call: () => number = () => 0;
				let run: () => unknown = () => undefined;

				Given("a call that throws a TypeError", () => {
					call = () => {
						throw thrown;
					};
				});
				When("it is attempted with the guard RangeError", () => {
					run = () => attempt(call, RangeError);
				});
				Then("the same TypeError is thrown to the caller", () => {
					expect(run).toThrow(thrown);
				});
			},
		);

		Scenario(
			"Attempt with no guard is a type error",
			({ Given, When, Then, And }) => {
				let call: () => number = () => 0;
				let run: () => unknown = () => undefined;

				Given("a call that may throw", () => {
					call = () => 1;
				});
				When("it is attempted with no guard", () => {
					run = () =>
						// @ts-expect-error at least one guard must be named
						attempt(call);
				});
				Then("the type checker refuses the call", () => {
					// The @ts-expect-error above fails `tsc` when the call becomes valid.
					expect(typeof run).toBe("function");
				});
				And("the call throws a TypeError at run time", () => {
					expect(run).toThrow(TypeError);
				});
			},
		);

		Scenario(
			"AttemptAsync returns Ok with the value a promise resolves to",
			({ Given, When, Then }) => {
				let call: () => Promise<number> = async () => 0;
				let outcome: unknown;

				Given("a promise that resolves to 7", () => {
					call = async () => 7;
				});
				When("it is attempted with the guard Error", async () => {
					outcome = await attemptAsync(call, Error);
				});
				Then("the result is an Ok holding 7", () => {
					expect(outcome).toEqual(new Ok(7));
				});
			},
		);

		Scenario(
			"AttemptAsync returns Err with a rejection of a named type",
			({ Given, When, Then }) => {
				const thrown = new RangeError("out of range");
				let call: () => Promise<number> = async () => 0;
				let outcome: unknown;

				Given("a promise that rejects with a RangeError", () => {
					call = () => Promise.reject(thrown);
				});
				When("it is attempted with the guard RangeError", async () => {
					outcome = await attemptAsync(call, RangeError);
				});
				Then("the result is an Err holding that same exception", () => {
					expect((outcome as Err<never, RangeError>).error).toBe(thrown);
				});
			},
		);

		Scenario(
			"AttemptAsync lets a rejection of another type through",
			({ Given, When, Then }) => {
				const thrown = new TypeError("wrong type");
				let call: () => Promise<number> = async () => 0;
				let pending: Promise<unknown> = Promise.resolve();

				Given("a promise that rejects with a TypeError", () => {
					call = () => Promise.reject(thrown);
				});
				When("it is attempted with the guard RangeError", () => {
					pending = attemptAsync(call, RangeError);
				});
				Then("the same TypeError is rejected to the caller", async () => {
					await expect(pending).rejects.toBe(thrown);
				});
			},
		);

		Scenario(
			"AttemptAsync catches a call that throws before it returns a promise",
			({ Given, When, Then }) => {
				const thrown = new RangeError("at once");
				let call: () => Promise<number> = async () => 0;
				let outcome: unknown;

				Given("a function that throws a RangeError at once", () => {
					call = () => {
						throw thrown;
					};
				});
				When("it is attempted with the guard RangeError", async () => {
					outcome = await attemptAsync(call, RangeError);
				});
				Then("the result is an Err holding that same exception", () => {
					expect((outcome as Err<never, RangeError>).error).toBe(thrown);
				});
			},
		);
	},
);
