// Retry with exponential backoff, a max attempt count and full jitter.
// Decision: docs/explanation/decisions/017-retry-backoff-jitter.md (why each retry has a max and full jitter).
// The library is pure: the caller injects `sleep` and `random`, so the same code runs in Node, the browser and k6. The real wait comes from `/timers`.

import type { Result } from "@flash/typekit";

// How long to wait between tries, in milliseconds. The wait doubles from baseMs and stops growing at capMs.
export type BackoffPolicy = { baseMs: number; capMs: number };

// A backoff policy plus the total number of tries, the first one included.
export type RetryPolicy = BackoffPolicy & { maxAttempts: number };

// The options of the sync retry: the policy, the injected wait and randomness, and an optional retry test.
export type RetryOptions<E> = RetryPolicy & {
	shouldRetry?: (error: E) => boolean;
	sleep: (ms: number) => void;
	random: () => number;
};

// The options of the async retry. The same as RetryOptions, with an async sleep and an optional signal. The signal
// stops further tries; the first try always runs.
export type RetryAsyncOptions<E> = RetryPolicy & {
	shouldRetry?: (error: E) => boolean;
	sleep: (ms: number) => Promise<void>;
	random: () => number;
	signal?: AbortSignal;
};

// Doubling spaces the retries further apart, so a struggling service gets less load after each failure.
const GROWTH_FACTOR = 2;
// 2 ** 1023 is the largest power of two a double holds. A larger attempt is clamped to it, so the product never
// becomes Infinity, and the cap then decides the bound.
const MAX_EXPONENT = 1023;
const FIRST_ATTEMPT = 0;
const SINGLE_TRY = 1;

const alwaysRetry = (): boolean => true;

// The jittered wait before the next try, in [0, bound). Full jitter spreads clients out, so many clients do not retry together.
// Attempt 0 is the wait after the first failure.
export function backoffDelayMs(
	attempt: number,
	policy: BackoffPolicy,
	random: () => number,
): number {
	const exponent = Math.min(Math.max(attempt, FIRST_ATTEMPT), MAX_EXPONENT);
	const bound = Math.min(
		policy.capMs,
		policy.baseMs * GROWTH_FACTOR ** exponent,
	);
	return random() * bound;
}

// The number of tries. A value that is not a finite number of at least one is treated as one try, so retry always
// ends and never hides the first failure. A fraction is rounded down.
function triesFor(maxAttempts: number): number {
	return Number.isFinite(maxAttempts) && maxAttempts >= SINGLE_TRY
		? Math.floor(maxAttempts)
		: SINGLE_TRY;
}

// Runs the task until it returns an Ok or the tries run out, and returns the last Result. A failure that `shouldRetry` refuses ends it at once.
// The task gets a 0-based attempt number. No wait follows the last try.
export function retry<T, E>(
	task: (attempt: number) => Result<T, E>,
	options: RetryOptions<E>,
): Result<T, E> {
	const tries = triesFor(options.maxAttempts);
	const shouldRetry = options.shouldRetry ?? alwaysRetry;
	let result = task(FIRST_ATTEMPT);
	for (
		let attempt = FIRST_ATTEMPT;
		attempt < tries - SINGLE_TRY;
		attempt += SINGLE_TRY
	) {
		if (result.isOk() || !shouldRetry(result.error)) return result;
		options.sleep(backoffDelayMs(attempt, options, options.random));
		result = task(attempt + SINGLE_TRY);
	}
	return result;
}

function isAborted(signal: AbortSignal | undefined): boolean {
	return signal?.aborted === true;
}

// The async form of retry. An aborted signal is checked before and after each wait, so no try starts after the caller gives up.
export async function retryAsync<T, E>(
	task: (attempt: number) => Promise<Result<T, E>>,
	options: RetryAsyncOptions<E>,
): Promise<Result<T, E>> {
	const tries = triesFor(options.maxAttempts);
	const shouldRetry = options.shouldRetry ?? alwaysRetry;
	let result = await task(FIRST_ATTEMPT);
	for (
		let attempt = FIRST_ATTEMPT;
		attempt < tries - SINGLE_TRY;
		attempt += SINGLE_TRY
	) {
		if (
			result.isOk() ||
			!shouldRetry(result.error) ||
			isAborted(options.signal)
		)
			return result;
		await options.sleep(backoffDelayMs(attempt, options, options.random));
		if (isAborted(options.signal)) return result;
		result = await task(attempt + SINGLE_TRY);
	}
	return result;
}
