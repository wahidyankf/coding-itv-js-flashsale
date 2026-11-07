// The UUID check the apps share: whether a text can be the id of a sale, a reservation or a product. flash-be's domain and
// flash-web's proxy both ask it, so the rule has one copy. Pure: a regular expression and nothing else.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Whether the text has the form of a UUID, in either case, as Postgres and `crypto.randomUUID` write it. A malformed id
// can never match a row, so a caller can refuse it before a lookup.
export function isUuid(value: string): boolean {
	return UUID.test(value);
}
