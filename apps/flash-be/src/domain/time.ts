// Time as the rules use it: the unit conversion, and when a thing with an end time still counts. The rules never read
// the clock; the caller passes `now`.

// The thousand that turns seconds into milliseconds, so no file writes it by hand.
export const MS_PER_SECOND = 1000;

// Whether something with an end time still counts at `now`. A hold, a login and a queue admission all end this way, so
// none of them needs a job to clear it: an old one stops counting on its own.
export function isLive(ending: { expiresAt: Date }, now: Date): boolean {
	return ending.expiresAt > now;
}
