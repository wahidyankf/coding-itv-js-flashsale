// Reads the time phrases of the scenarios ("in 2 hours", "1 hour ago") against a given moment. The phrase is the text a
// scenario writes, so every layer reads it the same way and picks its own clock. Pure: it reads no clock of its own.
import { MS_PER_HOUR } from "./time.js";

// Reads a phrase as the moment it names, counted from `now`. A phrase it does not read throws: a mistake in a scenario
// should stop the run, not guess a time.
export function relativeTime(phrase: string, now: Date): Date {
	const ahead = /^in (\d+) hours?$/.exec(phrase);
	if (ahead) return new Date(now.getTime() + Number(ahead[1]) * MS_PER_HOUR);
	const past = /^(\d+) hours? ago$/.exec(phrase);
	if (past) return new Date(now.getTime() - Number(past[1]) * MS_PER_HOUR);
	throw new Error(`cannot read the time "${phrase}"`);
}
