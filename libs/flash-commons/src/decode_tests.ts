// Unit tests for the decoder kit: each primitive on a good value and on the bad ones that matter, the object rules (a
// missing field, a wrong field, an unknown extra key, an optional key), the tagged union and the path of a nested error.
import { Err, Ok } from "@flash/typekit";
import { describe, expect, it } from "vitest";
import {
	both,
	type DecodeError,
	integer,
	isoDate,
	literal,
	nonEmptyText,
	nonNegativeInteger,
	object,
	oneOf,
	optional,
	tagged,
	text,
	uuid,
} from "./decode.js";

const UUID = "11111111-1111-4111-8111-111111111111";
const WHEN = "2026-06-01T12:00:00.000Z";

// The error of a value that is wrong at the root, with the given phrase.
const wrong = (expected: string): DecodeError => ({ path: "", expected });

// The values that are not text, and not a number, and not an object: the ones a bad payload is likely to carry.
const NOT_TEXT = [1, null, undefined, { text: "a" }];
const NOT_NUMBER = ["3", null, undefined, Number.NaN];

describe("text", () => {
	it("accepts any text, the empty one included", () => {
		expect(text("")).toEqual(new Ok(""));
		expect(text("Drop")).toEqual(new Ok("Drop"));
	});

	it.each(NOT_TEXT)("refuses %j", (value) => {
		expect(text(value)).toEqual(new Err(wrong("text")));
	});
});

describe("nonEmptyText", () => {
	it("accepts a text with something in it", () => {
		expect(nonEmptyText("ana")).toEqual(new Ok("ana"));
	});

	it("refuses the empty text and anything that is not text", () => {
		expect(nonEmptyText("")).toEqual(new Err(wrong("a non-empty text")));
		expect(nonEmptyText(7)).toEqual(new Err(wrong("a non-empty text")));
	});
});

describe("integer", () => {
	it("accepts whole numbers of either sign", () => {
		expect(integer(0)).toEqual(new Ok(0));
		expect(integer(-3)).toEqual(new Ok(-3));
		expect(integer(42)).toEqual(new Ok(42));
	});

	it.each([...NOT_NUMBER, 1.5, Number.POSITIVE_INFINITY, 2 ** 53])(
		"refuses %j",
		(value) => {
			expect(integer(value)).toEqual(new Err(wrong("an integer")));
		},
	);
});

describe("nonNegativeInteger", () => {
	it("accepts zero and whole numbers above it", () => {
		expect(nonNegativeInteger(0)).toEqual(new Ok(0));
		expect(nonNegativeInteger(7)).toEqual(new Ok(7));
	});

	it.each([-1, 1.5, "7", null])("refuses %j", (value) => {
		expect(nonNegativeInteger(value)).toEqual(
			new Err(wrong("a non-negative integer")),
		);
	});
});

describe("isoDate", () => {
	it.each([WHEN, "2026-06-01T12:00:00Z", "2026-06-01T12:00:00+02:00"])(
		"accepts %s",
		(value) => {
			expect(isoDate(value)).toEqual(new Ok(value));
		},
	);

	it.each([
		"June 1 2026",
		"2026-06-01",
		"2026-13-45T00:00:00Z",
		"2026-06-01T12:00:00",
		"",
	])("refuses %j", (value) => {
		expect(isoDate(value)).toEqual(new Err(wrong("an ISO date and time")));
	});

	it("refuses a value that is not text", () => {
		expect(isoDate(5)).toEqual(new Err(wrong("an ISO date and time")));
	});
});

describe("uuid", () => {
	it("accepts a UUID in either case", () => {
		expect(uuid(UUID)).toEqual(new Ok(UUID));
		expect(uuid(UUID.toUpperCase())).toEqual(new Ok(UUID.toUpperCase()));
	});

	it.each([
		"s1",
		"11111111-1111-4111-8111",
		"g1111111-1111-4111-8111-111111111111",
	])("refuses %j", (value) => {
		expect(uuid(value)).toEqual(new Err(wrong("a UUID")));
	});

	it("refuses a value that is not text", () => {
		expect(uuid(null)).toEqual(new Err(wrong("a UUID")));
	});
});

describe("literal", () => {
	it("accepts the one text it names", () => {
		expect(literal("ok")("ok")).toEqual(new Ok("ok"));
	});

	it("refuses every other value, and says which text it wanted", () => {
		expect(literal("ok")("OK")).toEqual(new Err(wrong('the text "ok"')));
		expect(literal("ok")(undefined)).toEqual(new Err(wrong('the text "ok"')));
	});
});

describe("oneOf", () => {
	const role = oneOf(["shopper", "operator"] as const);

	it("accepts each of the named values", () => {
		expect(role("shopper")).toEqual(new Ok("shopper"));
		expect(role("operator")).toEqual(new Ok("operator"));
	});

	it("refuses a value that is not one of them, and lists them", () => {
		expect(role("admin")).toEqual(
			new Err(wrong('one of "shopper", "operator"')),
		);
		expect(role(1)).toEqual(new Err(wrong('one of "shopper", "operator"')));
	});
});

describe("object", () => {
	const sale = object({ name: text, stock: integer });

	it("builds the typed object from the named fields", () => {
		expect(sale({ name: "Drop", stock: 10 })).toEqual(
			new Ok({ name: "Drop", stock: 10 }),
		);
	});

	it("ignores an extra key, so a reply that gains a field still reads", () => {
		expect(sale({ name: "Drop", stock: 10, newField: true })).toEqual(
			new Ok({ name: "Drop", stock: 10 }),
		);
	});

	it.each([null, undefined, "Drop", 3, [], [{ name: "Drop", stock: 10 }]])(
		"refuses %j, which is not an object",
		(value) => {
			expect(sale(value)).toEqual(new Err(wrong("an object")));
		},
	);

	it("names the field that is missing", () => {
		expect(sale({ name: "Drop" })).toEqual(
			new Err({ path: "stock", expected: "an integer" }),
		);
	});

	it("names the field that has the wrong type", () => {
		expect(sale({ name: 5, stock: 10 })).toEqual(
			new Err({ path: "name", expected: "text" }),
		);
	});

	it("names the path of a field inside a field", () => {
		const nested = object({ sale: object({ stock: integer }) });
		expect(nested({ sale: { stock: "10" } })).toEqual(
			new Err({ path: "sale.stock", expected: "an integer" }),
		);
		expect(nested({ sale: null })).toEqual(
			new Err({ path: "sale", expected: "an object" }),
		);
	});

	it("reports the first wrong field, in the order of the shape", () => {
		expect(sale({ name: 5, stock: "x" })).toEqual(
			new Err({ path: "name", expected: "text" }),
		);
	});

	describe("with an optional field", () => {
		const reply = object({ id: text, note: optional(text) });

		it("leaves the key out when the field is absent", () => {
			const decoded = reply({ id: "a" });
			expect(decoded).toEqual(new Ok({ id: "a" }));
			expect(decoded.isOk() && "note" in decoded.value).toBe(false);
		});

		it("leaves the key out when the field is undefined", () => {
			const decoded = reply({ id: "a", note: undefined });
			expect(decoded.isOk() && "note" in decoded.value).toBe(false);
		});

		it("keeps the field when it is there and right", () => {
			expect(reply({ id: "a", note: "hi" })).toEqual(
				new Ok({ id: "a", note: "hi" }),
			);
		});

		it("refuses the field when it is there and wrong, even as null", () => {
			expect(reply({ id: "a", note: 5 })).toEqual(
				new Err({ path: "note", expected: "text" }),
			);
			expect(reply({ id: "a", note: null })).toEqual(
				new Err({ path: "note", expected: "text" }),
			);
		});
	});
});

describe("tagged", () => {
	const outcome = tagged("state", {
		counted: object({ state: literal("counted"), total: integer }),
		empty: object({ state: literal("empty") }),
	});

	it("decodes the value with the branch its tag names", () => {
		expect(outcome({ state: "counted", total: 2 })).toEqual(
			new Ok({ state: "counted", total: 2 }),
		);
		expect(outcome({ state: "empty" })).toEqual(new Ok({ state: "empty" }));
	});

	it("names the tag when it is not one of the branches", () => {
		const names = { path: "state", expected: 'one of "counted", "empty"' };
		expect(outcome({ state: "lost" })).toEqual(new Err(names));
		expect(outcome({ state: 1 })).toEqual(new Err(names));
		expect(outcome({ total: 2 })).toEqual(new Err(names));
		expect(outcome({ state: "toString" })).toEqual(new Err(names));
	});

	it("refuses a value that is not an object", () => {
		expect(outcome(null)).toEqual(new Err(wrong("an object")));
	});

	it("reports an error inside the branch with its own path", () => {
		expect(outcome({ state: "counted", total: "2" })).toEqual(
			new Err({ path: "total", expected: "an integer" }),
		);
	});
});

describe("both", () => {
	const joined = both(object({ ticket: text }), object({ place: integer }));

	it("merges the fields of both decoders", () => {
		expect(joined({ ticket: "t", place: 4, extra: 1 })).toEqual(
			new Ok({ ticket: "t", place: 4 }),
		);
	});

	it("refuses with the error of the first decoder that fails", () => {
		expect(joined({ place: 4 })).toEqual(
			new Err({ path: "ticket", expected: "text" }),
		);
		expect(joined({ ticket: "t" })).toEqual(
			new Err({ path: "place", expected: "an integer" }),
		);
	});
});
