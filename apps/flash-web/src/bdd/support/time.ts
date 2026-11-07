// Reads the time phrases of the scenarios ("in 2 hours", "1 hour ago") against a given moment.
const HOUR_MS = 3_600_000;

// Reads phrases such as "in 2 hours" and "1 hour ago" against a given moment, so scenarios stay readable
// and each layer can pick its own clock.
export function relativeTime(phrase: string, now: Date): Date {
	const ahead = /^in (\d+) hours?$/.exec(phrase);
	if (ahead) return new Date(now.getTime() + Number(ahead[1]) * HOUR_MS);
	const past = /^(\d+) hours? ago$/.exec(phrase);
	if (past) return new Date(now.getTime() - Number(past[1]) * HOUR_MS);
	throw new Error(`cannot read the time "${phrase}"`);
}
