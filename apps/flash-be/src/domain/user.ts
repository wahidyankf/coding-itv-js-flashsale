// A user id is a short name the shopper types. It is trimmed and lowercased so "Ana " and "ana" are one person.
const USER_ID_PATTERN = /^[a-z0-9][a-z0-9._@+-]{0,63}$/;

// The usable form of the name, or `undefined` when it is not a usable name.
export function normalizeUser(raw: unknown): string | undefined {
	if (typeof raw !== "string") return undefined;
	const user = raw.trim().toLowerCase();
	return USER_ID_PATTERN.test(user) ? user : undefined;
}
