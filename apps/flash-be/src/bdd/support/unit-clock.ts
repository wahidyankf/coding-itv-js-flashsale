// The unit layer's way to wait for a request that waits on its clock: a payment there sleeps on a timer that only the
// scenario's clock fires, so the clock has to move for the request to answer.
import type { ShopScenario } from "./queue-scenario.js";

// The most seconds the clock moves for one request, well past any payment a scenario makes slow.
const MAX_CLOCK_SECONDS = 30;

// Moves the scenario's clock one second at a time until `work` settles, then gives its answer. It promises to stop
// after MAX_CLOCK_SECONDS, so a request that never answers fails the scenario instead of hanging it.
export async function byClock<T>(
	work: Promise<T>,
	scenario: Pick<ShopScenario, "advance">,
): Promise<T> {
	let done = false;
	const answer = work.finally(() => {
		done = true;
	});
	for (let step = 0; step < MAX_CLOCK_SECONDS && !done; step++) {
		await scenario.advance(1);
	}
	return answer;
}
