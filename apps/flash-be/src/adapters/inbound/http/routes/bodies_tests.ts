// Unit tests for the body decoders at the HTTP edge: what each route accepts, which field a refusal names, and the order
// the checks run in. The order is the API's answer: a sign-up checks the name, rule and type, before the password.
import { Ok, type Result } from "@flash/typekit";
import { describe, expect, it } from "vitest";
import {
	loginBody,
	refusalCode,
	reservationBody,
	saleDraftBody,
	salePatchBody,
	signUpBody,
} from "./bodies.js";

const PASSWORD = "a long password";
const DRAFT = {
	stock: 10,
	startsAt: "2026-06-01T12:00:00Z",
	endsAt: "2026-06-01T13:00:00Z",
};

// The path of the field a refusal names, or undefined when the value was accepted.
const refusedAt = (result: Result<unknown, { path: string }>) =>
	result.isErr() ? result.error.path : undefined;

describe("the sign-up body", () => {
	it("gives the name in its usable form, and the password as it was typed", () => {
		expect(signUpBody({ username: " Ana ", password: PASSWORD })).toEqual(
			new Ok({ username: "ana", password: PASSWORD }),
		);
	});

	it("refuses a missing name, or one that is not text, as the name", () => {
		expect(refusedAt(signUpBody({ password: PASSWORD }))).toBe("username");
		expect(refusedAt(signUpBody({ username: 5, password: PASSWORD }))).toBe(
			"username",
		);
	});

	it("refuses a name the rule does not make before it looks at the password", () => {
		expect(refusedAt(signUpBody({ username: "has space", password: 7 }))).toBe(
			"username",
		);
		expect(refusedAt(signUpBody({ username: "has space" }))).toBe("username");
	});

	it("refuses a usable name with a password that is not text as the password", () => {
		expect(refusedAt(signUpBody({ username: "a", password: 7 }))).toBe(
			"password",
		);
	});

	it("refuses a missing or short password as the password", () => {
		expect(refusedAt(signUpBody({ username: "ana" }))).toBe("password");
		expect(refusedAt(signUpBody({ username: "ana", password: 12345678 }))).toBe(
			"password",
		);
		expect(refusedAt(signUpBody({ username: "ana", password: "short" }))).toBe(
			"password",
		);
	});

	it.each([null, undefined, "ana", []])(
		"refuses %j, which is not an object, at the root",
		(value) => {
			expect(refusedAt(signUpBody(value))).toBe("");
		},
	);
});

describe("the login body", () => {
	it("gives the name in its usable form and the password as it was typed", () => {
		expect(loginBody({ username: "ANA", password: "x" })).toEqual(
			new Ok({ username: "ana", password: "x" }),
		);
	});

	it("does not check the length of the password, which a wrong one fails anyway", () => {
		expect(refusedAt(loginBody({ username: "ana", password: "x" }))).toBe(
			undefined,
		);
	});

	it("refuses a name the rule does not make, or a missing password", () => {
		expect(
			refusedAt(loginBody({ username: "has space", password: PASSWORD })),
		).toBe("username");
		expect(refusedAt(loginBody({ username: "ana" }))).toBe("password");
	});
});

describe("the reservation body", () => {
	it("gives the id as text; its shape is checked after the sale is found", () => {
		expect(reservationBody({ reservationId: "not-yet-checked" })).toEqual(
			new Ok({ reservationId: "not-yet-checked" }),
		);
	});

	it("refuses a missing id, and a body that is not an object, at the id's field", () => {
		expect(refusedAt(reservationBody({}))).toBe("reservationId");
		expect(refusedAt(reservationBody(null))).toBe("");
	});
});

describe("the sale bodies", () => {
	it("gives a new sale its fields, and leaves out the optional ones it did not get", () => {
		expect(saleDraftBody(DRAFT)).toEqual(new Ok(DRAFT));
	});

	it("takes the dates as text, so the window rule reads them as it always has", () => {
		expect(
			saleDraftBody({
				...DRAFT,
				startsAt: "2026-06-01",
				endsAt: "2026-06-02",
			}).isOk(),
		).toBe(true);
	});

	it("refuses a new sale whose stock is not a whole number, or whose dates are not text", () => {
		expect(refusedAt(saleDraftBody({ ...DRAFT, stock: "many" }))).toBe("stock");
		expect(refusedAt(saleDraftBody({ ...DRAFT, stock: 1.5 }))).toBe("stock");
		expect(refusedAt(saleDraftBody({ ...DRAFT, startsAt: 5 }))).toBe(
			"startsAt",
		);
		expect(refusedAt(saleDraftBody({ stock: 10 }))).toBe("startsAt");
	});

	it("refuses a null optional field, as a field of the wrong type", () => {
		expect(refusedAt(saleDraftBody({ ...DRAFT, name: null }))).toBe("name");
	});

	it("gives a change only the fields that are there", () => {
		expect(salePatchBody({ name: "New" })).toEqual(new Ok({ name: "New" }));
		expect(salePatchBody({})).toEqual(new Ok({}));
	});

	it("refuses a change with a field of the wrong type, or a null field", () => {
		expect(refusedAt(salePatchBody({ stock: "many" }))).toBe("stock");
		expect(refusedAt(salePatchBody({ stock: null }))).toBe("stock");
	});
});

describe("refusalCode", () => {
	const SIGN_UP = {
		username: "invalid_user",
		password: "invalid_password",
	} as const;

	it("answers with the code of the field the error names", () => {
		expect(
			refusalCode(
				{ path: "password", expected: "text" },
				SIGN_UP,
				"invalid_user",
			),
		).toBe("invalid_password");
	});

	it("answers with the code of the whole body for an error at the root, or in a field the code does not name", () => {
		expect(
			refusalCode({ path: "", expected: "an object" }, SIGN_UP, "invalid_user"),
		).toBe("invalid_user");
		expect(
			refusalCode({ path: "sale.stock", expected: "text" }, {}, "invalid_sale"),
		).toBe("invalid_sale");
	});
});
