import { type Option, Some } from "@flash/typekit";

// A user id is a short name the shopper types. It is trimmed and lowercased so "Ana " and "ana" are one person.
const USER_PATTERN = /^[a-z0-9][a-z0-9._@+-]{0,63}$/;

export function normalizeUser(raw: unknown): Option<string> {
	if (typeof raw !== "string") return undefined;
	const user = raw.trim().toLowerCase();
	return USER_PATTERN.test(user) ? new Some(user) : undefined;
}
