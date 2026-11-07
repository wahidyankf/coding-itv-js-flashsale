// Reading a request body. A body is client text, so nothing in it is trusted until it is checked: `fieldOf` hands a field
// back as `unknown`, and each route checks the type it needs. Inbound HTTP adapter.
import type { ErrorCode } from "../errors.js";

// A field of a value that has not been checked yet, such as a body. It is undefined when the value is not an object or
// has no such field.
export const fieldOf = (source: unknown, name: string): unknown =>
	typeof source === "object" && source !== null && name in source
		? Reflect.get(source, name)
		: undefined;

// The error for a body field that is missing or not text. Only the reservation id is checked this way.
const FIELD_ERROR = {
	reservationId: "invalid_reservation",
} as const;

// The error of the first of `fields` that is missing or not text, checked before anything else is looked at. Nothing is
// returned when all of them are there.
export function missingFieldError(
	body: unknown,
	fields: ReadonlyArray<keyof typeof FIELD_ERROR>,
): ErrorCode | undefined {
	const missing = fields.find(
		(name) => typeof fieldOf(body, name) !== "string",
	);
	return missing === undefined ? undefined : FIELD_ERROR[missing];
}
