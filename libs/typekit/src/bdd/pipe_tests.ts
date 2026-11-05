import { describeFeature, loadFeature } from "@amiceli/vitest-cucumber";
import { expect, expectTypeOf } from "vitest";
import * as option from "../option.js";
import { type Option, Some } from "../option.js";
import { pipe } from "../pipeline.js";
import * as result from "../result.js";
import { Err, Ok, type Result } from "../result.js";
import { specFile } from "./support/paths.js";

const parse = (text: string): Result<number, string> => {
	const number = Number(text);
	return Number.isNaN(number)
		? new Err(`not a number: ${text}`)
		: new Ok(number);
};

const lookup = (key: string): Option<number> =>
	key === "a" ? new Some(1) : undefined;

describeFeature(
	await loadFeature(specFile("typekit/pipe/piping.feature")),
	({ Scenario }) => {
		Scenario(
			"Pipe applies each function to the result of the one before",
			({ Given, When, Then, And }) => {
				const order: string[] = [];
				let output: string | undefined;

				Given(
					"the value 3 and the functions add one, double and stringify",
					() => {
						order.length = 0;
					},
				);
				When("they are piped", () => {
					output = pipe(
						3,
						(n) => {
							order.push("add");
							return n + 1;
						},
						(n) => {
							order.push("double");
							return n * 2;
						},
						(n) => {
							order.push("stringify");
							return String(n);
						},
					);
				});
				Then('the result is "8"', () => {
					expect(output).toBe("8");
				});
				And("each function ran once in order", () => {
					expect(order).toEqual(["add", "double", "stringify"]);
				});
			},
		);

		Scenario(
			"Pipe chains a Result through the curried combinators",
			({ Given, When, Then, And }) => {
				let good: Result<string, string> = new Ok("");
				let bad: Result<string, string> = new Err("");
				let calls = 0;

				Given("a Result parsed from text", () => {
					calls = 0;
				});
				When("it is piped through result.map and result.flatMap", () => {
					const run = (text: string) =>
						pipe(
							parse(text),
							result.map((n) => n * 2),
							result.flatMap((n) => {
								calls += 1;
								return new Ok(String(n));
							}),
						);
					good = run("21");
					bad = run("x");
				});
				Then("a good text gives an Ok", () => {
					expect(good).toEqual(new Ok("42"));
				});
				And("a bad text gives an Err and the later stages do not run", () => {
					expect(bad).toEqual(new Err("not a number: x"));
					expect(calls).toBe(1);
				});
			},
		);

		Scenario(
			"Pipe chains an Option through the curried combinators",
			({ Given, When, Then, And }) => {
				let found: Result<number, string> = new Err("");
				let missing: Result<number, string> = new Ok(0);
				let calls = 0;

				Given("an Option read from a lookup", () => {
					calls = 0;
				});
				When("it is piped through option.map and option.okOr", () => {
					const run = (key: string) =>
						pipe(
							lookup(key),
							option.map((n) => {
								calls += 1;
								return n + 1;
							}),
							option.okOr<number, string>("missing"),
						);
					found = run("a");
					missing = run("b");
				});
				Then("a found key gives an Ok", () => {
					expect(found).toEqual(new Ok(2));
				});
				And(
					"a missing key gives an Err and the later stages do not run",
					() => {
						expect(missing).toEqual(new Err("missing"));
						expect(calls).toBe(1);
					},
				);
			},
		);

		Scenario(
			"Pipe stops at the first function that throws",
			({ Given, When, Then, And }) => {
				const boom = new Error("boom");
				let third = 0;
				let run: () => unknown = () => undefined;

				Given("three functions where the second throws", () => {
					third = 0;
				});
				When("they are piped", () => {
					run = () =>
						pipe(
							1,
							(n) => n + 1,
							(): number => {
								throw boom;
							},
							(n) => {
								third += 1;
								return n;
							},
						);
				});
				Then("the exception reaches the caller", () => {
					expect(run).toThrow(boom);
				});
				And("the third function never ran", () => {
					expect(third).toBe(0);
				});
			},
		);

		Scenario("Pipe refuses a mismatched stage", ({ Given, When, Then }) => {
			let run: () => unknown = () => undefined;

			Given(
				"a stage that expects a number after a stage that returns a string",
				() => {
					run = () =>
						pipe(
							1,
							// @ts-expect-error the second stage expects a number, not a string
							(n) => String(n),
							(n: number) => n + 1,
						);
				},
			);
			When("they are piped", () => {
				expect(typeof run).toBe("function");
			});
			Then("the type checker refuses the call", () => {
				// The @ts-expect-error above fails `tsc` when the call becomes valid.
				expect(typeof run).toBe("function");
			});
		});

		Scenario(
			"Pipe nests to chain more than nine stages",
			({ Given, When, Then }) => {
				const add = (n: number) => n + 1;
				let output = 0;

				Given("ten functions that each add one", () => {
					output = 0;
				});
				When(
					"the first nine are piped and the result is piped through the tenth",
					() => {
						output = pipe(
							pipe(0, add, add, add, add, add, add, add, add, add),
							add,
						);
					},
				);
				Then("the result is 10 and its type is a number", () => {
					expect(output).toBe(10);
					expectTypeOf(output).toEqualTypeOf<number>();
				});
			},
		);
	},
);
