// Who a user is, as the rules see it. A username is the name a person logs in with; the queue, holds and purchases are
// keyed on it. A user id is the id of the user's row, held by sessions and the audit columns. Both are branded text, so
// one cannot pass for the other. Domain layer: no I/O.

// The name a shopper or an operator logs in with. `normalizeUser` makes one from typed text, and `storedUsername` from a
// name a row holds. No other code makes one.
export type Username = string & { readonly __brand: "Username" };

// The id of a user row. It is never a username, and no route takes one from the client. `userIdOf` makes one.
export type UserId = string & { readonly __brand: "UserId" };

const USERNAME_PATTERN = /^[a-z0-9][a-z0-9._@+-]{0,63}$/;

// Trims and lowercases typed text, so "Ana " and "ana" are one person. Returns `undefined` for an unusable name.
// This is the only rule for what a name may be; the edge only decodes the text.
export function normalizeUser(raw: string): Username | undefined {
	const user = raw.trim().toLowerCase();
	return USERNAME_PATTERN.test(user) ? (user as Username) : undefined;
}

// The name a row or a cached login holds. A write checked it with `normalizeUser`, so a read does not check it again.
export function storedUsername(stored: string): Username {
	return stored as Username;
}

// The id a row holds, read back as a user id. It is the one place a `UserId` is made from text.
export function userIdOf(stored: string): UserId {
	return stored as UserId;
}
