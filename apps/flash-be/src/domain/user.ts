// Who a user is, as the rules see it. The domain has two names for a user, and the types say which one a value holds.
// A username is the name a person logs in with: it is what the queue, the holds and the purchases are keyed on. A user
// id is the id of the user's row: sessions, the audit columns and the operator who acted all hold one. Both are text,
// and each is branded, so one cannot be passed where the other is meant. Domain layer: no I/O.

// The name a shopper or an operator logs in with. `normalizeUser` makes one from typed text, and `storedUsername` from a
// name a row holds. No other code makes one.
export type Username = string & { readonly __brand: "Username" };

// The id of a user row. It is never a username, and no route takes one from the client. `userIdOf` makes one.
export type UserId = string & { readonly __brand: "UserId" };

const USERNAME_PATTERN = /^[a-z0-9][a-z0-9._@+-]{0,63}$/;

// The usable form of a typed name: trimmed and lowercased, so "Ana " and "ana" are one person. `undefined` when the text
// is not a usable name. The edge decodes the text first; this rule is the only one that says what a name may be.
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
