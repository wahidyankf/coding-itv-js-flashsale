// Waiting for a condition that the layer's real clients reach on their own time, such as a reconnect. A scenario
// waits with it instead of sleeping for a fixed time, so a fast run stays fast.
import { sleep } from "@flash/flash-commons/timers";

// How often `waitFor` looks at its condition again, in milliseconds.
const POLL_MS = 50;

// Polls `check` until it holds, and reports whether it held before `timeoutMs` ran out. It never throws, so a caller
// decides what a timeout means.
export async function waitFor(
	check: () => boolean,
	timeoutMs: number,
): Promise<boolean> {
	const deadline = Date.now() + timeoutMs;
	while (!check()) {
		if (Date.now() > deadline) return false;
		await sleep(POLL_MS);
	}
	return true;
}
