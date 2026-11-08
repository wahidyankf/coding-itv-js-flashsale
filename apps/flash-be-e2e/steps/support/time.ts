// Time for the e2e steps: the reader of phrases such as "in 2 hours", the sale windows, the pauses and the waits for a state.
// The units and the reader come from @flash/flash-commons, so every step means the same by "an hour". Both e2e apps use this file.
import { MS_PER_MINUTE, retryAsync } from "@flash/flash-commons";
import { sleep } from "@flash/flash-commons/timers";
import { Err, Ok, type Result } from "@flash/typekit";

// The phrase reader of flash-commons, so every step reads "in 2 hours" the same way.
export { relativeTime } from "@flash/flash-commons";

// The longest a poll waits between two checks. Backoff doubles the wait up to here, so a change is seen within a second.
const POLL_CAP_MS = 1000;
// The reason a check did not pass yet. It is never shown: the caller's failure message is what a reader sees.
const NOT_YET = "not yet";

// The window of a sale that starts `startsInMinutes` from now (negative for a start in the past) and lasts `minutes`.
export function windowFromNow(startsInMinutes: number, minutes: number) {
	const startsAt = new Date(Date.now() + startsInMinutes * MS_PER_MINUTE);
	return {
		startsAt,
		endsAt: new Date(startsAt.getTime() + minutes * MS_PER_MINUTE),
	};
}

// How many checks fit in `window` when each wait is, on average, half of its backoff bound (full jitter draws a wait
// uniformly below the bound). The backoff starts at `everyMs` and doubles up to the cap, as retryAsync computes it.
function checksFor(window: number, everyMs: number): number {
	let checks = 1;
	let spent = 0;
	let bound = Math.min(POLL_CAP_MS, everyMs);
	while (spent < window) {
		spent += bound / 2;
		bound = Math.min(POLL_CAP_MS, bound * 2);
		checks += 1;
	}
	return checks;
}

// Calls `check` until it returns true or `withinMs` has passed, then throws `failure`. The first check runs at once. Each later
// check waits a jittered backoff from `everyMs`, so a slow state is not hammered. The deadline stops the poll.
// `everyMs` must be above 0, or the attempt count would never grow.
export async function pollUntil(
	check: () => Promise<boolean>,
	options: { withinMs: number; everyMs: number; failure: string },
): Promise<void> {
	if (!(options.everyMs > 0)) {
		throw new Error(`pollUntil needs everyMs above 0, got ${options.everyMs}`);
	}
	// A window that has already passed (a caller computes it from a deadline) still gets one check, as before.
	const window = Math.max(0, options.withinMs);
	const deadline = Date.now() + window;
	// A wait never runs past the deadline, because a sleep cannot be cut short by the signal below.
	const waitUntilDeadline = (ms: number) =>
		sleep(Math.min(ms, Math.max(0, deadline - Date.now())));
	const result = await retryAsync(
		async (): Promise<Result<void, string>> =>
			(await check()) ? new Ok(undefined) : new Err(NOT_YET),
		{
			baseMs: options.everyMs,
			capMs: POLL_CAP_MS,
			maxAttempts: checksFor(window, options.everyMs),
			sleep: waitUntilDeadline,
			random: Math.random,
			signal: AbortSignal.timeout(window),
		},
	);
	if (result.isErr()) throw new Error(options.failure);
}
