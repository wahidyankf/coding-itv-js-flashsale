// Time for the e2e steps: the units the scenarios count in, the reading of phrases such as "in 2 hours", the windows of a sale,
// the pauses, and the waits for the API to reach a state. Shared by both e2e apps, so every step says the same thing by
// "an hour".

export const MS_PER_SECOND = 1000;
export const MINUTE_MS = 60_000;
export const HOUR_MS = 3_600_000;

// Reads phrases such as "in 2 hours" and "1 hour ago" against a given moment. Any other phrase is a mistake in a scenario,
// so it throws rather than guessing.
export function relativeTime(phrase: string, now: Date): Date {
	const ahead = /^in (\d+) hours?$/.exec(phrase);
	if (ahead) return new Date(now.getTime() + Number(ahead[1]) * HOUR_MS);
	const past = /^(\d+) hours? ago$/.exec(phrase);
	if (past) return new Date(now.getTime() - Number(past[1]) * HOUR_MS);
	throw new Error(`cannot read the time "${phrase}"`);
}

// The window of a sale that starts `startsInMinutes` from now (negative for a start in the past) and lasts `minutes`.
export function windowFromNow(startsInMinutes: number, minutes: number) {
	const startsAt = new Date(Date.now() + startsInMinutes * MINUTE_MS);
	return {
		startsAt,
		endsAt: new Date(startsAt.getTime() + minutes * MINUTE_MS),
	};
}

// Waits for `ms` milliseconds. Steps use it to let the API move on (a queue tick, a hold running out) before they look.
export function sleep(ms: number): Promise<void> {
	return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

// Calls `check` every `everyMs` until it returns true. When `withinMs` passes first, it throws `failure`. Steps use it for
// every wait on an API state, so the timing of such waits is set in one place.
export async function pollUntil(
	check: () => Promise<boolean>,
	options: { withinMs: number; everyMs: number; failure: string },
): Promise<void> {
	const deadline = Date.now() + options.withinMs;
	while (!(await check())) {
		if (Date.now() > deadline) throw new Error(options.failure);
		await sleep(options.everyMs);
	}
}
