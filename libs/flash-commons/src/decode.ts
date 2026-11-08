// A small decoder kit for payloads that cross a process boundary: API replies, stream events and request bodies.
// A bad payload becomes an Err at the edge, so it never reaches the app.
// Decision: docs/explanation/decisions/018-decode-payloads-at-the-edge.md (why a small kit, not a schema library). The kit is pure: no I/O, timers or randomness.

import { Err, Ok, type Result } from "@flash/typekit";
import { isUuid } from "./uuid.js";

// The one error a decoder returns. It names the field that was wrong, so a log can say where a payload broke without the payload.
// `path` is dotted, such as `sale.stock`; `expected` is a short phrase for a developer, such as "an integer".
export type DecodeError = { path: string; expected: string };

// A decoder never throws on a bad value. It returns an Err, so the caller must handle the bad payload as a value.
export type Decoder<T> = (value: unknown) => Result<T, DecodeError>;

// Marks a field that `object` may skip. Built by `optional`.
export type Optional<T> = {
	readonly optional: true;
	readonly decode: Decoder<T>;
};

// The fields of an object: a decoder for a required field, or `optional` for a field that may be absent.
type Field = Decoder<unknown> | Optional<unknown>;
type Shape = Record<string, Field>;

// The type a field decodes to. A required field has its decoder's type; an optional one has the type it wraps.
type Infer<F> =
	F extends Decoder<infer T> ? T : F extends Optional<infer T> ? T : never;
type RequiredKeys<S> = {
	[K in keyof S]: S[K] extends Optional<unknown> ? never : K;
}[keyof S];
type OptionalKeys<S> = Exclude<keyof S, RequiredKeys<S>>;
type Shaped<S> = { [K in RequiredKeys<S>]: Infer<S[K]> } & {
	[K in OptionalKeys<S>]?: Infer<S[K]>;
};

// The branches of a tagged union: each one decodes a whole object, and the tag picks which one.
type Branches = Record<string, Decoder<object>>;
type BranchOf<B> = {
	[K in keyof B]: B[K] extends Decoder<infer T> ? T : never;
}[keyof B];

// The lengths and patterns the primitives check. A number that is a rule is named here, not written in a check.
const MIN_COUNT = 0;
const ISO_DATE =
	/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

// The failure of a value at the root. An enclosing object adds the name of the field it sits in.
const fail = (expected: string) =>
	new Err<never, DecodeError>({ path: "", expected });
const quote = (word: string) => JSON.stringify(word);
const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);
const isOptional = (field: Field): field is Optional<unknown> =>
	typeof field !== "function";

// Any text. A value that is not a string is refused.
export const text: Decoder<string> = (value) =>
	typeof value === "string" ? new Ok(value) : fail("text");

// Text with at least one character. Use it for a name or an id that an empty value would break.
export const nonEmptyText: Decoder<string> = (value) =>
	typeof value === "string" && value !== ""
		? new Ok(value)
		: fail("a non-empty text");

// A whole number that a JavaScript number holds exactly, of either sign.
export const integer: Decoder<number> = (value) =>
	typeof value === "number" && Number.isSafeInteger(value)
		? new Ok(value)
		: fail("an integer");

// A whole number that a JavaScript number holds exactly, from zero up: a count, or a length of time.
export const nonNegativeInteger: Decoder<number> = (value) =>
	typeof value === "number" && Number.isSafeInteger(value) && value >= MIN_COUNT
		? new Ok(value)
		: fail("a non-negative integer");

// An ISO 8601 date and time with a zone, as JSON carries a `Date`. It keeps the text, so the app's types stay strings;
// the text must also parse to a real date, so `2026-13-45T00:00:00Z` is refused.
export const isoDate: Decoder<string> = (value) =>
	typeof value === "string" &&
	ISO_DATE.test(value) &&
	!Number.isNaN(Date.parse(value))
		? new Ok(value)
		: fail("an ISO date and time");

// A UUID in either case, the form Postgres and `crypto.randomUUID` write.
export const uuid: Decoder<string> = (value) =>
	typeof value === "string" && isUuid(value) ? new Ok(value) : fail("a UUID");

// Runs an app's rule after a decoder, so the rule never sees a value of the wrong shape.
// The rule returns `undefined` to refuse a value; `expected` names what it wanted.
export function refine<T, U>(
	decode: Decoder<T>,
	rule: (value: T) => U | undefined,
	expected: string,
): Decoder<U> {
	return (value) => {
		const decoded = decode(value);
		if (decoded.isErr()) return new Err(decoded.error);
		const made = rule(decoded.value);
		return made === undefined ? fail(expected) : new Ok(made);
	};
}

// Exactly the text it names. Used for the tag of a branch, or a fixed word such as "ok".
export function literal<const V extends string>(wanted: V): Decoder<V> {
	const phrase = `the text ${quote(wanted)}`;
	return (value) => (value === wanted ? new Ok(wanted) : fail(phrase));
}

// One of the texts it lists. The value it returns is the listed one, so its type is the union of the list.
export function oneOf<const V extends readonly string[]>(
	values: V,
): Decoder<V[number]> {
	const phrase = `one of ${values.map(quote).join(", ")}`;
	return (value) => {
		const found = values.find((candidate) => candidate === value);
		return found === undefined ? fail(phrase) : new Ok(found);
	};
}

// A field that may be left out. An absent key, or one whose value is `undefined`, is left out of the result; a key that
// is there with a value must decode. Only `object` reads it.
export function optional<T>(decode: Decoder<T>): Optional<T> {
	return { optional: true, decode };
}

// Puts a field name in front of the path of an error inside it: `stock`, then `sale.stock`.
function within(key: string, error: DecodeError): DecodeError {
	return {
		path: error.path === "" ? key : `${key}.${error.path}`,
		expected: error.expected,
	};
}

// Keys the shape does not name are ignored, so an API reply can gain a field without breaking the app.
// A missing or wrong field is refused, and the error names it.
export function object<S extends Shape>(shape: S): Decoder<Shaped<S>> {
	return (value) => {
		if (!isRecord(value)) return fail("an object");
		const out: Record<string, unknown> = {};
		for (const [key, field] of Object.entries(shape)) {
			const raw = value[key];
			if (raw === undefined && isOptional(field)) continue;
			const decoded = (isOptional(field) ? field.decode : field)(raw);
			if (decoded.isErr()) return new Err(within(key, decoded.error));
			out[key] = decoded.value;
		}
		// `out` has one key for each field of the shape, which is the type `Shaped<S>`. TypeScript cannot follow a key
		// built in a loop through the generic, so the type is stated here.
		return new Ok(out as Shaped<S>);
	};
}

// A union of objects, told apart by the text in one field (the tag). The tag picks the branch, and that branch decodes
// the whole object, so the tag is one of its fields too. A tag that names no branch is refused, and the error names it.
export function tagged<B extends Branches>(
	key: string,
	branches: B,
): Decoder<BranchOf<B>> {
	const table: Branches = branches;
	const phrase = `one of ${Object.keys(table).map(quote).join(", ")}`;
	return (value) => {
		if (!isRecord(value)) return fail("an object");
		const tag = value[key];
		const branch =
			typeof tag === "string" && Object.hasOwn(table, tag)
				? table[tag]
				: undefined;
		if (branch === undefined) return new Err({ path: key, expected: phrase });
		// The branch the tag named decodes the value, so its type is one of the branches. The union is stated here.
		return branch(value) as Result<BranchOf<B>, DecodeError>;
	};
}

// The fields of two decoders read from the same object, merged into one. The first decoder that fails stops it.
export function both<A extends object, C extends object>(
	first: Decoder<A>,
	second: Decoder<C>,
): Decoder<A & C> {
	return (value) => {
		const a = first(value);
		if (a.isErr()) return new Err(a.error);
		const c = second(value);
		if (c.isErr()) return new Err(c.error);
		return new Ok({ ...a.value, ...c.value });
	};
}
