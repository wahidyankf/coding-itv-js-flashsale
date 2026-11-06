import { describeFeature, loadFeature } from "@amiceli/vitest-cucumber";
import { expect } from "vitest";
import { assertNever } from "../match.js";
import * as result from "../result.js";
import { Err, Ok, type Result } from "../result.js";
import { specFile } from "./support/paths.js";

type Light = "red" | "amber" | "green";

describeFeature(
	await loadFeature(specFile("typekit/match/matching.feature")),
	({ Scenario }) => {
		Scenario(
			"Match on a Result runs the handler of its side",
			({ Given, When, Then, And }) => {
				let good: Result<number, string> = new Ok(2);
				let bad: Result<number, string> = new Err("bad");
				let fromGood = "";
				let fromBad = "";

				Given('an Ok holding 2 and an Err holding "bad"', () => {
					good = new Ok(2);
					bad = new Err("bad");
				});
				When("each is matched with a handler per side", () => {
					const handlers = {
						ok: (n: number) => `ok ${n}`,
						err: (e: string) => `err ${e}`,
					};
					fromGood = good.match(handlers);
					fromBad = bad.match(handlers);
				});
				Then("the Ok runs the ok handler with 2", () => {
					expect(fromGood).toBe("ok 2");
				});
				And('the Err runs the err handler with "bad"', () => {
					expect(fromBad).toBe("err bad");
				});
			},
		);

		Scenario(
			"A match without a handler for a side is a type error",
			({ Given, When, Then }) => {
				let good: Result<number, string> = new Ok(2);
				let run: () => unknown = () => undefined;

				Given("a Result", () => {
					good = new Ok(2);
				});
				When("each is matched without one of its handlers", () => {
					run = () => [
						// @ts-expect-error the err handler is missing
						good.match({ ok: (n: number) => n }),
						// @ts-expect-error the curried result match needs both handlers too
						result.match({ ok: (n: number) => n }),
					];
				});
				Then("the type checker refuses both calls", () => {
					// The @ts-expect-error lines above fail `tsc` when a call becomes valid.
					expect(typeof run).toBe("function");
				});
			},
		);

		Scenario(
			"A switch that forgets a case is a type error",
			({ Given, When, Then }) => {
				let describe: (light: Light) => string = () => "";

				Given("a union of three string literals", () => {
					describe = () => "";
				});
				When("a switch handles two of them and ends with assertNever", () => {
					describe = (light: Light): string => {
						switch (light) {
							case "red":
								return "stop";
							case "amber":
								return "slow";
							default:
								// @ts-expect-error "green" is not handled, so it is not never
								return assertNever(light);
						}
					};
				});
				Then("the type checker refuses the call", () => {
					// The @ts-expect-error above fails `tsc` when the switch becomes exhaustive.
					expect(describe("red")).toBe("stop");
				});
			},
		);

		Scenario("AssertNever throws if it is reached", ({ Given, When, Then }) => {
			let value: unknown;
			let run: () => unknown = () => undefined;

			Given("a value that the types said could not exist", () => {
				value = "surprise";
			});
			When("it is passed to assertNever", () => {
				run = () => assertNever(value as never);
			});
			Then("an error names the value", () => {
				expect(run).toThrow(/surprise/);
			});
		});
	},
);
