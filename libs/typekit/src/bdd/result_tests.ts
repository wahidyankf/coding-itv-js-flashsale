import { describeFeature, loadFeature } from "@amiceli/vitest-cucumber";
import { expect, expectTypeOf } from "vitest";
import { Err, Ok, type Result } from "../result.js";
import { specFile } from "./support/paths.js";

describeFeature(
	await loadFeature(specFile("typekit/result/transforming.feature")),
	({ Scenario }) => {
		Scenario(
			"Map changes the value of an Ok and leaves an Err alone",
			({ Given, When, Then, And }) => {
				let good: Result<number, string> = new Ok(2);
				let bad: Result<number, string> = new Err("bad");
				let mappedGood: Result<number, string> = good;
				let mappedBad: Result<number, string> = bad;

				Given('an Ok holding 2 and an Err holding "bad"', () => {
					good = new Ok(2);
					bad = new Err("bad");
				});
				When("both are mapped with a function that doubles", () => {
					mappedGood = good.map((n) => n * 2);
					mappedBad = bad.map((n) => n * 2);
				});
				Then("the Ok holds 4", () => {
					expect(mappedGood).toEqual(new Ok(4));
				});
				And('the Err still holds "bad"', () => {
					expect(mappedBad).toEqual(new Err("bad"));
				});
			},
		);

		Scenario(
			"MapErr changes the fault of an Err and leaves an Ok alone",
			({ Given, When, Then, And }) => {
				let good: Result<number, string> = new Ok(2);
				let bad: Result<number, string> = new Err("bad");
				let mappedGood: Result<number, string> = good;
				let mappedBad: Result<number, string> = bad;

				Given('an Ok holding 2 and an Err holding "bad"', () => {
					good = new Ok(2);
					bad = new Err("bad");
				});
				When(
					"both are mapped on the fault with a function that upper-cases",
					() => {
						mappedGood = good.mapErr((e) => e.toUpperCase());
						mappedBad = bad.mapErr((e) => e.toUpperCase());
					},
				);
				Then('the Err holds "BAD"', () => {
					expect(mappedBad).toEqual(new Err("BAD"));
				});
				And("the Ok still holds 2", () => {
					expect(mappedGood).toEqual(new Ok(2));
				});
			},
		);

		Scenario(
			"FlatMap continues an Ok with a step that may fail",
			({ Given, When, Then, And }) => {
				let two: Result<number, string> = new Ok(2);
				let three: Result<number, string> = new Ok(3);
				let bad: Result<number, string> = new Err("bad");
				let results: Result<number, string>[] = [];
				let calls = 0;

				Given(
					'an Ok holding 2, an Ok holding 3 and an Err holding "bad"',
					() => {
						two = new Ok(2);
						three = new Ok(3);
						bad = new Err("bad");
					},
				);
				When("each continues with a step that fails for odd numbers", () => {
					const step = (n: number): Result<number, string> => {
						calls += 1;
						return n % 2 === 0 ? new Ok(n) : new Err("odd");
					};
					results = [two.flatMap(step), three.flatMap(step), bad.flatMap(step)];
				});
				Then("the Ok holding 2 stays an Ok", () => {
					expect(results[0]).toEqual(new Ok(2));
				});
				And("the Ok holding 3 becomes an Err", () => {
					expect(results[1]).toEqual(new Err("odd"));
				});
				And("the Err is returned and the step does not run", () => {
					expect(results[2]).toEqual(new Err("bad"));
					expect(calls).toBe(2);
				});
			},
		);

		Scenario(
			"FlatMapErr recovers an Err with a step that may fail",
			({ Given, When, Then, And }) => {
				let good: Result<number, string> = new Ok(2);
				let bad: Result<number, string> = new Err("bad");
				let recoveredGood: Result<number, string> = good;
				let recoveredBad: Result<number, string> = bad;
				let calls = 0;

				Given('an Ok holding 2 and an Err holding "bad"', () => {
					good = new Ok(2);
					bad = new Err("bad");
				});
				When(
					"both are recovered with a step that turns the fault into a value",
					() => {
						const step = (): Result<number, string> => {
							calls += 1;
							return new Ok(3);
						};
						recoveredGood = good.flatMapErr(step);
						recoveredBad = bad.flatMapErr(step);
					},
				);
				Then("the Err becomes an Ok holding 3", () => {
					expect(recoveredBad).toEqual(new Ok(3));
				});
				And("the Ok is returned and the step does not run", () => {
					expect(recoveredGood).toEqual(new Ok(2));
					expect(calls).toBe(1);
				});
			},
		);

		Scenario(
			"Tap shows the value of an Ok and returns the result unchanged",
			({ Given, When, Then, And }) => {
				let good: Result<number, string> = new Ok(2);
				let bad: Result<number, string> = new Err("bad");
				let tappedGood: Result<number, string> = good;
				let tappedBad: Result<number, string> = bad;
				const seen: number[] = [];

				Given('an Ok holding 2 and an Err holding "bad"', () => {
					good = new Ok(2);
					bad = new Err("bad");
				});
				When("both are tapped with a recorder", () => {
					tappedGood = good.tap((n) => seen.push(n));
					tappedBad = bad.tap((n) => seen.push(n));
				});
				Then("the recorder saw 2 only once", () => {
					expect(seen).toEqual([2]);
				});
				And("both results are returned unchanged", () => {
					expect(tappedGood).toBe(good);
					expect(tappedBad).toBe(bad);
				});
			},
		);

		Scenario(
			"TapErr shows the fault of an Err and returns the result unchanged",
			({ Given, When, Then, And }) => {
				let good: Result<number, string> = new Ok(2);
				let bad: Result<number, string> = new Err("bad");
				let tappedGood: Result<number, string> = good;
				let tappedBad: Result<number, string> = bad;
				const seen: string[] = [];

				Given('an Ok holding 2 and an Err holding "bad"', () => {
					good = new Ok(2);
					bad = new Err("bad");
				});
				When("both are tapped on the fault with a recorder", () => {
					tappedGood = good.tapErr((e) => seen.push(e));
					tappedBad = bad.tapErr((e) => seen.push(e));
				});
				Then('the recorder saw "bad" only once', () => {
					expect(seen).toEqual(["bad"]);
				});
				And("both results are returned unchanged", () => {
					expect(tappedGood).toBe(good);
					expect(tappedBad).toBe(bad);
				});
			},
		);

		Scenario(
			"A Result cannot be changed after it is built",
			({ Given, When, Then, And }) => {
				let good: Ok<number> = new Ok(2);
				let bad: Err<never, string> = new Err("bad");
				const attempts: (() => void)[] = [];

				Given('an Ok holding 2 and an Err holding "bad"', () => {
					good = new Ok(2);
					bad = new Err("bad");
				});
				When("code tries to assign to a field of each", () => {
					attempts.push(() => {
						// @ts-expect-error value is readonly
						good.value = 3;
					});
					attempts.push(() => {
						// @ts-expect-error error is readonly
						bad.error = "worse";
					});
				});
				Then("each assignment throws", () => {
					for (const attempt of attempts) expect(attempt).toThrow(TypeError);
				});
				And("each stays as it was", () => {
					expect(good.value).toBe(2);
					expect(bad.error).toBe("bad");
				});
			},
		);
	},
);

// Types: an Ok of a narrower type is a Result of a wider one (the classes are covariant).
expectTypeOf<Ok<boolean>>().toExtend<Ok<number | boolean>>();
expectTypeOf<Ok<number>>().toExtend<Result<number, string>>();
expectTypeOf<Err<never, string>>().toExtend<Result<number, string>>();
