// Step bodies that many features bind the same way: the status and the error code of the last reply. A feature binds the
// wording itself, in its own file, and calls these for the check, so the check reads the same wherever it is used.
import type { StepTest } from "@amiceli/vitest-cucumber";
import { expect } from "vitest";
import { type ReplyHolder, responseOf } from "./response.js";

// The steps a scenario binds, given the scenario it is in. A feature binds each scenario with one of these.
export type ScenarioBinder = (steps: StepTest) => void;

// One row of a scenario outline's examples, read by column name.
export type ExampleRow = Record<string, string>;

// The steps of a scenario outline, given the scenario and the row of examples it runs with.
export type OutlineBinder = (steps: StepTest, examples: ExampleRow) => void;

// "the response status is {int}": the last reply has the status the scenario names.
export function statusIs(holder: ReplyHolder) {
	return (_ctx: unknown, status: number) => {
		expect(responseOf(holder).statusCode).toBe(status);
	};
}

// "the error is {string}": the body of the last reply carries the error code the scenario names.
export function errorIs(holder: ReplyHolder) {
	return (_ctx: unknown, error: string) => {
		expect(responseOf(holder).json().errorCode).toBe(error);
	};
}
