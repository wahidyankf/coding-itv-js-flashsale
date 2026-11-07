// The chaos timers of a run. The chaos profile stops Redis part way through the run and starts it again later, while
// shoppers keep arriving. With --calm no timer is set, so the same run is a control without the failure.
import type { Profile } from "../k6/profiles.ts";
import { composeRedis } from "./compose.ts";

const MS_PER_SECOND = 1000;
// The report's wording for each action on Redis.
const PAST_TENSE = { stop: "stopped", start: "started" } as const;

export type Chaos = {
	// What the timers did, in the order they fired. The report lists it.
	events: string[];
	// Clears the timers that have not fired yet. A timer that fired has already done its work.
	cancel(): void;
};

// Sets the timers of a run. Nothing is set when the profile has no chaos or when calm is true.
export function startChaos(profile: Profile, calm: boolean): Chaos {
	const events: string[] = [];
	const timers: NodeJS.Timeout[] = [];
	if (!calm && profile.redisStopsAtSeconds !== undefined) {
		timers.push(redisAt(profile.redisStopsAtSeconds, "stop", events));
	}
	if (!calm && profile.redisStartsAtSeconds !== undefined) {
		timers.push(redisAt(profile.redisStartsAtSeconds, "start", events));
	}
	return {
		events,
		cancel: () => {
			for (const timer of timers) clearTimeout(timer);
		},
	};
}

// Stops or starts the redis container after the given seconds of the run, and records it.
function redisAt(
	seconds: number,
	action: "stop" | "start",
	events: string[],
): NodeJS.Timeout {
	return setTimeout(() => {
		events.push(`Redis ${PAST_TENSE[action]} at +${seconds}s`);
		composeRedis(action);
	}, seconds * MS_PER_SECOND);
}
