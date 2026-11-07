// Who a user is, as the rules see it. The domain has two names for a user, and the types say which one a value holds.
// A username is the name a person logs in with: it is what the queue, the holds and the purchases are keyed on. A user
// id is the id of the user's row: sessions, the audit columns and the operator who acted all hold one. Both are text.

// The name a shopper or an operator logs in with, in the form `normalizeUser` returns.
export type Username = string;

// The id of a user row. It is never a username, and no route takes one from the client.
export type UserId = string;

const USERNAME_PATTERN = /^[a-z0-9][a-z0-9._@+-]{0,63}$/;

// The usable form of a typed name: trimmed and lowercased, so "Ana " and "ana" are one person. `undefined` when the text
// is not a usable name.
export function normalizeUser(raw: unknown): Username | undefined {
	if (typeof raw !== "string") return undefined;
	const user = raw.trim().toLowerCase();
	return USERNAME_PATTERN.test(user) ? user : undefined;
}
