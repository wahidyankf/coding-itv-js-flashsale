// Time phrases for the scenarios ("in 2 hours", "1 hour ago"). The scenarios stay readable, and each layer can pick its
// own clock. The hour they are counted in is the shared unit from @flash/flash-commons.
import { MS_PER_HOUR } from "@flash/flash-commons";

// Reads a phrase against a given moment, so a layer can pick its own clock.
export function relativeTime(phrase: string, now: Date): Date {
	const ahead = /^in (\d+) hours?$/.exec(phrase);
	if (ahead) return new Date(now.getTime() + Number(ahead[1]) * MS_PER_HOUR);
	const past = /^(\d+) hours? ago$/.exec(phrase);
	if (past) return new Date(now.getTime() - Number(past[1]) * MS_PER_HOUR);
	throw new Error(`cannot read the time "${phrase}"`);
}
