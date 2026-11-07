// Plain Vitest tests for retry, retryAsync and backoffDelayMs. The rules are the library's own, not a shopper's
// contract, so they have no Gherkin scenario. The values below are the expected results, so literals are fine here.
import { Err, Ok, type Result } from "@flash/typekit";
import { describe, expect, expectTypeOf, it } from "vitest";
import {
	type BackoffPolicy,
	backoffDelayMs,
	type RetryAsyncOptions,
	type RetryOptions,
	type RetryPolicy,
	retry,
	retryAsync,
} from "./retry.js";

type Outcome = Result<number, string>;

const half = () => 0.5;
const policy: BackoffPolicy = { baseMs: 100, capMs: 1000 };
const retryPolicy: RetryPolicy = { baseMs: 100, capMs: 1000, maxAttempts: 4 };

function recorder() {
	const sleeps: number[] = [];
	return {
		sleeps,
		sleep: (ms: number): void => {
			sleeps.push(ms);
		},
	};
}

function asyncRecorder() {
	const sleeps: number[] = [];
	return {
		sleeps,
		sleep: (ms: number): Promise<void> => {
			sleeps.push(ms);
			return Promise.resolve();
		},
	};
}

describe("backoffDelayMs", () => {
	it("doubles the bound with each attempt, counting from 0", () => {
		const roomy = { baseMs: 100, capMs: 100_000 };
		const delays = [0, 1, 2, 3].map((attempt) =>
			backoffDelayMs(attempt, roomy, half),
		);
		expect(delays).toEqual([50, 100, 200, 400]);
	});

	it("stops growing at the cap", () => {
		const delays = [0, 1, 2, 3, 4, 5].map((attempt) =>
			backoffDelayMs(attempt, policy, half),
		);
		expect(delays).toEqual([50, 100, 200, 400, 500, 500]);
	});

	it("draws a delay in [0, bound) from random", () => {
		expect(backoffDelayMs(2, policy, () => 0)).toBe(0);
		expect(backoffDelayMs(2, policy, half)).toBe(200);
		const nearTop = backoffDelayMs(2, policy, () => 0.999);
		expect(nearTop).toBeCloseTo(399.6);
		expect(nearTop).toBeLessThan(400);
	});

	it("stays finite and at the cap bound for a huge attempt number", () => {
		const cases = [1_000_000, Number.MAX_SAFE_INTEGER];
		for (const attempt of cases) {
			const delay = backoffDelayMs(attempt, policy, half);
			expect(Number.isFinite(delay)).toBe(true);
			expect(delay).toBe(500);
		}
	});

	it("stays at the cap when the doubling would overflow to Infinity", () => {
		const huge = { baseMs: 1e300, capMs: 1000 };
		const delay = backoffDelayMs(2000, huge, half);
		expect(Number.isFinite(delay)).toBe(true);
		expect(delay).toBe(500);
	});

	it("returns 0 for a zero base instead of NaN", () => {
		expect(backoffDelayMs(5000, { baseMs: 0, capMs: 1000 }, half)).toBe(0);
	});
});

describe("retry", () => {
	it("returns the first Ok at once and never sleeps", () => {
		const seen: number[] = [];
		const { sleeps, sleep } = recorder();
		const result = retry<number, string>(
			(attempt) => {
				seen.push(attempt);
				return new Ok(7);
			},
			{ ...retryPolicy, sleep, random: half },
		);
		expect(result).toEqual(new Ok(7));
		expect(seen).toEqual([0]);
		expect(sleeps).toEqual([]);
	});

	it("retries until an Ok, waiting the backoff between tries", () => {
		const outcomes: Outcome[] = [new Err("a"), new Err("b"), new Ok(3)];
		const { sleeps, sleep } = recorder();
		const result = retry<number, string>(
			(attempt) => outcomes[attempt] ?? new Err("out of range"),
			{
				...retryPolicy,
				sleep,
				random: half,
			},
		);
		expect(result).toEqual(new Ok(3));
		expect(sleeps).toEqual([50, 100]);
	});

	it("stops at maxAttempts and returns the last Err", () => {
		const seen: number[] = [];
		const { sleeps, sleep } = recorder();
		const result = retry<number, string>(
			(attempt) => {
				seen.push(attempt);
				return new Err(`fail ${attempt}`);
			},
			{ ...retryPolicy, sleep, random: half },
		);
		expect(result).toEqual(new Err("fail 3"));
		expect(seen).toEqual([0, 1, 2, 3]);
		expect(sleeps).toHaveLength(3);
	});

	it("does not sleep after the last try", () => {
		const { sleeps, sleep } = recorder();
		retry<number, string>(() => new Err("no"), {
			...retryPolicy,
			maxAttempts: 2,
			sleep,
			random: half,
		});
		expect(sleeps).toEqual([50]);
	});

	it("passes the 0-based attempt number to the task", () => {
		const outcomes: Outcome[] = [new Err("a"), new Err("b"), new Ok(1)];
		const seen: number[] = [];
		retry<number, string>(
			(attempt) => {
				seen.push(attempt);
				return outcomes[attempt] ?? new Err("out of range");
			},
			{ ...retryPolicy, sleep: recorder().sleep, random: half },
		);
		expect(seen).toEqual([0, 1, 2]);
	});

	it("stops at once when shouldRetry says no", () => {
		const seen: number[] = [];
		const { sleeps, sleep } = recorder();
		const result = retry<number, string>(
			(attempt) => {
				seen.push(attempt);
				return new Err("fatal");
			},
			{
				...retryPolicy,
				shouldRetry: (error) => error !== "fatal",
				sleep,
				random: half,
			},
		);
		expect(result).toEqual(new Err("fatal"));
		expect(seen).toEqual([0]);
		expect(sleeps).toEqual([]);
	});

	it("asks shouldRetry about each error and retries only the ones it accepts", () => {
		const outcomes: Outcome[] = [
			new Err("transient"),
			new Err("fatal"),
			new Ok(1),
		];
		const asked: string[] = [];
		const result = retry<number, string>(
			(attempt) => outcomes[attempt] ?? new Err("out of range"),
			{
				...retryPolicy,
				shouldRetry: (error) => {
					asked.push(error);
					return error === "transient";
				},
				sleep: recorder().sleep,
				random: half,
			},
		);
		expect(asked).toEqual(["transient", "fatal"]);
		expect(result).toEqual(new Err("fatal"));
	});

	it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
		"treats maxAttempts %s as one try with no wait",
		(maxAttempts) => {
			const seen: number[] = [];
			const { sleeps, sleep } = recorder();
			const result = retry<number, string>(
				(attempt) => {
					seen.push(attempt);
					return new Err("once");
				},
				{ ...retryPolicy, maxAttempts, sleep, random: half },
			);
			expect(result).toEqual(new Err("once"));
			expect(seen).toEqual([0]);
			expect(sleeps).toEqual([]);
		},
	);

	it("floors a fractional maxAttempts", () => {
		const seen: number[] = [];
		retry<number, string>(
			(attempt) => {
				seen.push(attempt);
				return new Err("no");
			},
			{
				...retryPolicy,
				maxAttempts: 2.7,
				sleep: recorder().sleep,
				random: half,
			},
		);
		expect(seen).toEqual([0, 1]);
	});

	it("waits the backoff delay for each wait", () => {
		const { sleeps, sleep } = recorder();
		retry<number, string>(() => new Err("no"), {
			baseMs: 100,
			capMs: 300,
			maxAttempts: 5,
			sleep,
			random: half,
		});
		expect(sleeps).toEqual([50, 100, 150, 150]);
	});
});

describe("retryAsync", () => {
	it("returns the first Ok at once and never sleeps", async () => {
		const seen: number[] = [];
		const { sleeps, sleep } = asyncRecorder();
		const result = await retryAsync<number, string>(
			(attempt) => {
				seen.push(attempt);
				return Promise.resolve(new Ok(7));
			},
			{ ...retryPolicy, sleep, random: half },
		);
		expect(result).toEqual(new Ok(7));
		expect(seen).toEqual([0]);
		expect(sleeps).toEqual([]);
	});

	it("retries until an Ok, waiting the backoff between tries", async () => {
		const outcomes: Outcome[] = [new Err("a"), new Err("b"), new Ok(3)];
		const { sleeps, sleep } = asyncRecorder();
		const result = await retryAsync<number, string>(
			(attempt) =>
				Promise.resolve(outcomes[attempt] ?? new Err("out of range")),
			{ ...retryPolicy, sleep, random: half },
		);
		expect(result).toEqual(new Ok(3));
		expect(sleeps).toEqual([50, 100]);
	});

	it("stops at maxAttempts, returns the last Err, and does not sleep after the last try", async () => {
		const seen: number[] = [];
		const { sleeps, sleep } = asyncRecorder();
		const result = await retryAsync<number, string>(
			(attempt) => {
				seen.push(attempt);
				return Promise.resolve(new Err(`fail ${attempt}`));
			},
			{ ...retryPolicy, sleep, random: half },
		);
		expect(result).toEqual(new Err("fail 3"));
		expect(seen).toEqual([0, 1, 2, 3]);
		expect(sleeps).toHaveLength(3);
	});

	it("stops at once when shouldRetry says no", async () => {
		const seen: number[] = [];
		const { sleeps, sleep } = asyncRecorder();
		const result = await retryAsync<number, string>(
			(attempt) => {
				seen.push(attempt);
				return Promise.resolve(new Err("fatal"));
			},
			{
				...retryPolicy,
				shouldRetry: (error) => error !== "fatal",
				sleep,
				random: half,
			},
		);
		expect(result).toEqual(new Err("fatal"));
		expect(seen).toEqual([0]);
		expect(sleeps).toEqual([]);
	});

	it("passes the 0-based attempt number to the task", async () => {
		const outcomes: Outcome[] = [new Err("a"), new Err("b"), new Ok(1)];
		const seen: number[] = [];
		await retryAsync<number, string>(
			(attempt) => {
				seen.push(attempt);
				return Promise.resolve(outcomes[attempt] ?? new Err("out of range"));
			},
			{ ...retryPolicy, sleep: asyncRecorder().sleep, random: half },
		);
		expect(seen).toEqual([0, 1, 2]);
	});

	it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
		"treats maxAttempts %s as one try with no wait",
		async (maxAttempts) => {
			const seen: number[] = [];
			const { sleeps, sleep } = asyncRecorder();
			const result = await retryAsync<number, string>(
				(attempt) => {
					seen.push(attempt);
					return Promise.resolve(new Err("once"));
				},
				{ ...retryPolicy, maxAttempts, sleep, random: half },
			);
			expect(result).toEqual(new Err("once"));
			expect(seen).toEqual([0]);
			expect(sleeps).toEqual([]);
		},
	);

	it("does not try again once the signal is aborted before a wait", async () => {
		const controller = new AbortController();
		controller.abort();
		const seen: number[] = [];
		const { sleeps, sleep } = asyncRecorder();
		const result = await retryAsync<number, string>(
			(attempt) => {
				seen.push(attempt);
				return Promise.resolve(new Err("no"));
			},
			{ ...retryPolicy, sleep, random: half, signal: controller.signal },
		);
		expect(result).toEqual(new Err("no"));
		expect(seen).toEqual([0]);
		expect(sleeps).toEqual([]);
	});

	it("does not start the next try when the signal is aborted during the wait", async () => {
		const controller = new AbortController();
		const seen: number[] = [];
		const sleeps: number[] = [];
		const options: RetryAsyncOptions<string> = {
			...retryPolicy,
			random: half,
			signal: controller.signal,
			sleep: (ms) => {
				sleeps.push(ms);
				controller.abort();
				return Promise.resolve();
			},
		};
		const result = await retryAsync<number, string>((attempt) => {
			seen.push(attempt);
			return Promise.resolve(new Err("no"));
		}, options);
		expect(result).toEqual(new Err("no"));
		expect(seen).toEqual([0]);
		expect(sleeps).toEqual([50]);
	});

	it("runs normally with a signal that is never aborted", async () => {
		const controller = new AbortController();
		const outcomes: Outcome[] = [new Err("a"), new Ok(2)];
		const result = await retryAsync<number, string>(
			(attempt) =>
				Promise.resolve(outcomes[attempt] ?? new Err("out of range")),
			{
				...retryPolicy,
				sleep: asyncRecorder().sleep,
				random: half,
				signal: controller.signal,
			},
		);
		expect(result).toEqual(new Ok(2));
	});
});

describe("option types", () => {
	it("keeps the sync and async options apart by the sleep they take", () => {
		expectTypeOf<RetryOptions<string>["sleep"]>().toEqualTypeOf<
			(ms: number) => void
		>();
		expectTypeOf<RetryAsyncOptions<string>["sleep"]>().toEqualTypeOf<
			(ms: number) => Promise<void>
		>();
	});
});
