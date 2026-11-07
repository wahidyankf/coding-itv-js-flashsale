// The one timer helper of @flash/flash-commons. It sits on its own entry point, `@flash/flash-commons/timers`, because the
// main entry is pure and starts no timer. Only the callers that wait import it, and they inject it where a test must not
// wait for real.

// Resolves after `ms` milliseconds. With a `signal`, it resolves early when the signal aborts, and clears its timer, so
// nothing is left running. It never rejects: a caller that needs to know whether the wait was cut short checks
// `signal.aborted` after it.
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
	return new Promise<void>((resolve) => {
		if (signal?.aborted) {
			resolve();
			return;
		}
		// Ends the wait once, whichever comes first: the timer or the abort. The listener is removed, so a long-lived
		// signal keeps no reference to a wait that has ended.
		const finish = (): void => {
			clearTimeout(timer);
			signal?.removeEventListener("abort", finish);
			resolve();
		};
		const timer = setTimeout(finish, ms);
		signal?.addEventListener("abort", finish, { once: true });
	});
}
