// Reads the time phrases of the scenarios ("in 2 hours", "1 hour ago") against a given moment. Test support only.
import { MS_PER_HOUR } from "@flash/flash-commons";

// Reads phrases such as "in 2 hours" and "1 hour ago" against a given moment, so scenarios stay readable
// and each layer can pick its own clock.
export function relativeTime(phrase: string, now: Date): Date {
	const ahead = /^in (\d+) hours?$/.exec(phrase);
	if (ahead) return new Date(now.getTime() + Number(ahead[1]) * MS_PER_HOUR);
	const past = /^(\d+) hours? ago$/.exec(phrase);
	if (past) return new Date(now.getTime() - Number(past[1]) * MS_PER_HOUR);
	throw new Error(`cannot read the time "${phrase}"`);
}
