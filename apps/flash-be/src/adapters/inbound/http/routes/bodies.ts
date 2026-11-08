// The request bodies of the HTTP API, decoded at the edge, so a use case gets typed values and never the raw body. A
// refusal is answered with the code of its field (`refusalCode`). The rules a value must meet belong to the domain; the
// decoders call them. Inbound HTTP adapter. Decision: docs/explanation/decisions/018-decode-payloads-at-the-edge.md.
import {
	type DecodeError,
	type Decoder,
	integer,
	object,
	optional,
	refine,
	text,
} from "@flash/flash-commons";
import {
	PASSWORD_MAX_LENGTH,
	PASSWORD_MIN_LENGTH,
	usablePassword,
} from "../../../../domain/auth.js";
import { normalizeUser, type Username } from "../../../../domain/user.js";
import type { ErrorCode } from "../errors.js";

// A user name in a body: text that the domain's rule makes usable. The use case receives the `Username` it makes.
const userName: Decoder<Username> = refine(text, normalizeUser, "a user name");

// A password of a sign-up: text of a usable length, by the domain's rule.
const newPassword: Decoder<string> = refine(
	text,
	usablePassword,
	`a password of ${PASSWORD_MIN_LENGTH} to ${PASSWORD_MAX_LENGTH} characters`,
);

// The body of a sign-up. The name is checked first, and `object` stops at the first refused field, so a reply names one
// field.
export const signUpBody = object({ username: userName, password: newPassword });

// The body of a login. A name the rule refuses is refused as a wrong login, not as a bad name, so a reply never says
// which part was wrong. The password is only read as text: any wrong password is a wrong login.
export const loginBody = object({ username: userName, password: text });

// The body of a purchase. The id is read as text here, and its shape is checked after the sale is found.
export const reservationBody = object({ reservationId: text });

// The body of a new sale. Types are checked here; the window, stock and rates are domain rules. Dates stay text, because
// the domain parses them.
export const saleDraftBody = object({
	productId: optional(text),
	name: optional(text),
	stock: integer,
	startsAt: text,
	endsAt: text,
	holdSeconds: optional(integer),
	admitPerSecond: optional(integer),
});

// The body of a sale change. A field that is left out stays as it is; the domain refuses a change with no field at all.
export const salePatchBody = object({
	name: optional(text),
	startsAt: optional(text),
	endsAt: optional(text),
	stock: optional(integer),
	holdSeconds: optional(integer),
	admitPerSecond: optional(integer),
});

// The code each field of a sign-up answers with when it is refused. A name is refused before a password is looked at.
const SIGN_UP_FIELDS = {
	username: "invalid_user",
	password: "invalid_password",
} as const;

// The code a refused sign-up answers with: the field's own code, or the name's code for a body that is not an object.
export const signUpRefusal = (error: DecodeError): ErrorCode =>
	refusalCode(error, SIGN_UP_FIELDS, "invalid_user");

// The code a refused body answers with: the field's own code when `fields` has one, else the code of the whole body.
export function refusalCode(
	error: DecodeError,
	fields: Partial<Record<string, ErrorCode>>,
	whole: ErrorCode,
): ErrorCode {
	const dot = error.path.indexOf(".");
	const field = dot < 0 ? error.path : error.path.slice(0, dot);
	return fields[field] ?? whole;
}
