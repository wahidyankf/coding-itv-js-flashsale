// Time phrases for the scenarios ("in 2 hours", "1 hour ago"), and the hour they are counted in. The scenarios stay
// readable, and each layer can pick its own clock.

// One hour in milliseconds: the unit the phrases below count in.
export const HOUR_MS = 3_600_000;

// Reads a phrase against a given moment, so a layer can pick its own clock.
export function relativeTime(phrase: string, now: Date): Date {
	const ahead = /^in (\d+) hours?$/.exec(phrase);
	if (ahead) return new Date(now.getTime() + Number(ahead[1]) * HOUR_MS);
	const past = /^(\d+) hours? ago$/.exec(phrase);
	if (past) return new Date(now.getTime() - Number(past[1]) * HOUR_MS);
	throw new Error(`cannot read the time "${phrase}"`);
}
