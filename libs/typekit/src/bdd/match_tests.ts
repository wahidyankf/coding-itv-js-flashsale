import { describeFeature, loadFeature } from "@amiceli/vitest-cucumber";
import { expect } from "vitest";
import { Err, Ok, type Result } from "../result.js";
import { specFile } from "./support/paths.js";

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
					];
				});
				Then("the type checker refuses the call", () => {
					// The @ts-expect-error lines above fail `tsc` when a call becomes valid.
					expect(typeof run).toBe("function");
				});
			},
		);
	},
);
