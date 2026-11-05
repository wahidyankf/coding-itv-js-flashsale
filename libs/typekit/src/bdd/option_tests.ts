import { describeFeature, loadFeature } from "@amiceli/vitest-cucumber";
import { expect } from "vitest";
import * as option from "../option.js";
import { fromOptional, type Option, Some } from "../option.js";
import { Err, Ok, type Result } from "../result.js";
import { specFile } from "./support/paths.js";

describeFeature(
	await loadFeature(specFile("typekit/option/transforming.feature")),
	({ Scenario }) => {
		Scenario(
			"FromOptional keeps a falsy value present",
			({ Given, When, Then, And }) => {
				let values: (number | string | boolean | undefined)[] = [];
				let options: Option<number | string | boolean>[] = [];

				Given("the values 0, an empty string, false and undefined", () => {
					values = [0, "", false, undefined];
				});
				When("each is turned into an Option", () => {
					options = values.map((value) => fromOptional(value));
				});
				Then("the first three are present", () => {
					expect(options.slice(0, 3)).toEqual([
						new Some(0),
						new Some(""),
						new Some(false),
					]);
				});
				And("undefined is absent", () => {
					expect(options[3]).toBeUndefined();
				});
			},
		);

		Scenario(
			"Some of undefined is present and holds undefined",
			({ Given, When, Then, And }) => {
				let held: Option<undefined>;
				let present = false;

				Given("Some holding undefined", () => {
					held = new Some(undefined);
				});
				When("it is compared with absence", () => {
					present = held !== undefined;
				});
				Then("it is present", () => {
					expect(present).toBe(true);
				});
				And("its value is undefined", () => {
					expect(held?.value).toBeUndefined();
				});
			},
		);

		Scenario(
			"Option map changes a present value and leaves absence absent",
			({ Given, When, Then, And }) => {
				let present: Option<number>;
				let absent: Option<number>;
				let mappedPresent: Option<number>;
				let mappedAbsent: Option<number>;

				Given("a present 2 and an absent value", () => {
					present = new Some(2);
					absent = undefined;
				});
				When("both are mapped with a function that doubles", () => {
					mappedPresent = option.map((n: number) => n * 2)(present);
					mappedAbsent = option.map((n: number) => n * 2)(absent);
				});
				Then("the present value holds 4", () => {
					expect(mappedPresent).toEqual(new Some(4));
				});
				And("absence stays absent", () => {
					expect(mappedAbsent).toBeUndefined();
				});
			},
		);

		Scenario(
			"Option flatMap continues a present value with a step that may be absent",
			({ Given, When, Then, And }) => {
				let two: Option<number>;
				let three: Option<number>;
				let absent: Option<number>;
				let results: Option<number>[] = [];
				let calls = 0;

				Given("a present 2 and an absent value", () => {
					two = new Some(2);
					three = new Some(3);
					absent = undefined;
				});
				When("both continue with a step that is absent for odd numbers", () => {
					const step = (n: number): Option<number> => {
						calls += 1;
						return n % 2 === 0 ? new Some(n) : undefined;
					};
					const run = option.flatMap(step);
					results = [run(two), run(three), run(absent)];
				});
				Then("a step that answers presence gives a present value", () => {
					expect(results[0]).toEqual(new Some(2));
				});
				And("a step that answers absence gives absence", () => {
					expect(results[1]).toBeUndefined();
				});
				And("absence is returned and the step does not run", () => {
					expect(results[2]).toBeUndefined();
					expect(calls).toBe(2);
				});
			},
		);

		Scenario(
			"Option tap shows a present value and returns the option unchanged",
			({ Given, When, Then, And }) => {
				let present: Option<number>;
				let absent: Option<number>;
				let tappedPresent: Option<number>;
				let tappedAbsent: Option<number> = new Some(0);
				const seen: number[] = [];

				Given("a present 2 and an absent value", () => {
					present = new Some(2);
					absent = undefined;
				});
				When("both are tapped with a recorder", () => {
					const tap = option.tap((n: number) => seen.push(n));
					tappedPresent = tap(present);
					tappedAbsent = tap(absent);
				});
				Then("the recorder saw 2 only once", () => {
					expect(seen).toEqual([2]);
				});
				And("both options are returned unchanged", () => {
					expect(tappedPresent).toBe(present);
					expect(tappedAbsent).toBeUndefined();
				});
			},
		);

		Scenario(
			"OkOr turns presence into Ok and absence into Err",
			({ Given, When, Then, And }) => {
				let present: Option<number>;
				let absent: Option<number>;
				let fromPresent: Result<number, string> = new Err("unset");
				let fromAbsent: Result<number, string> = new Ok(0);

				Given("a present 2 and an absent value", () => {
					present = new Some(2);
					absent = undefined;
				});
				When('both are turned into a Result with the fault "missing"', () => {
					const turn = option.okOr<number, string>("missing");
					fromPresent = turn(present);
					fromAbsent = turn(absent);
				});
				Then("the present value becomes an Ok holding 2", () => {
					expect(fromPresent).toEqual(new Ok(2));
				});
				And('absence becomes an Err holding "missing"', () => {
					expect(fromAbsent).toEqual(new Err("missing"));
				});
			},
		);
	},
);
