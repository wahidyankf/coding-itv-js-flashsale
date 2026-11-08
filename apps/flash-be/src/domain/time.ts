// Time as the rules use it (domain layer): when a thing with an end time still counts. The rules never read the clock;
// the caller passes `now`. The unit conversions live in @flash/flash-commons, so this file holds only the rule.

// Whether something with an end time still counts at `now`. A hold, a login and a queue admission all end this way, so
// none of them needs a job to clear it: an old one stops counting on its own.
export function isLive(ending: { expiresAt: Date }, now: Date): boolean {
	return ending.expiresAt > now;
}
