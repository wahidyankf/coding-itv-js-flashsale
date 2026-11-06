// The words of the API that need no schema library: format rules, header names and error codes. The domain of the
// backend imports this file, so it stays free of Zod and of I/O. The schemas and routes are built from it in the
// main entry of the package.

// A user id is a short name the shopper types. It is trimmed and lowercased so "Ana " and "ana" are one person.
export const USER_ID_PATTERN = /^[a-z0-9][a-z0-9._@+-]{0,63}$/;

export function normalizeUserId(raw: unknown): string | undefined {
	if (typeof raw !== "string") return undefined;
	const user = raw.trim().toLowerCase();
	return USER_ID_PATTERN.test(user) ? user : undefined;
}

export const UUID_PATTERN =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
	return UUID_PATTERN.test(value);
}

export const TICKET_HEADER = "x-queue-ticket";
export const RETRY_AFTER_HEADER = "retry-after";
// The operator proves who they are with `Authorization: Bearer <token>`.
export const ADMIN_AUTH_HEADER = "authorization";

export const SALE_STATUSES = [
	"upcoming",
	"active",
	"sold_out",
	"ended",
] as const;
export type SaleStatus = (typeof SALE_STATUSES)[number];

// Every error code of the API and the HTTP status that answers it. A code has one status everywhere.
export const ERROR_STATUS = {
	invalid_user: 400,
	invalid_reservation: 400,
	invalid_request: 400,
	invalid_sale: 400,
	invalid_ticket: 401,
	invalid_admin_token: 401,
	payment_failed: 402,
	not_admitted: 403,
	sale_not_found: 404,
	not_in_queue: 404,
	reservation_not_found: 404,
	not_found: 404,
	sale_not_started: 409,
	sale_ended: 409,
	sold_out: 409,
	hold_expired: 409,
	already_purchased: 409,
	sale_overlaps: 409,
	rate_limited: 429,
	internal: 500,
	backend_unavailable: 502,
	unavailable: 503,
} as const;

export type ErrorCode = keyof typeof ERROR_STATUS;

// One sentence for each error code, for a developer reading a reply or a log. A shopper's text is the business of the web
// app. The type makes a new code fail to compile until it has a sentence. `internal` says nothing of the cause.
export const ERROR_MESSAGE = {
	invalid_user: "The user id is missing or not valid.",
	invalid_reservation: "The reservation id is missing or not valid.",
	invalid_request: "The request could not be read.",
	invalid_sale: "The sale to create is not valid.",
	invalid_ticket: "The queue ticket is missing or not valid.",
	invalid_admin_token: "The admin token is missing or wrong.",
	payment_failed: "The payment did not go through.",
	not_admitted: "The shopper has not been admitted yet.",
	sale_not_found: "No sale was found.",
	not_in_queue: "The shopper is not in the queue.",
	reservation_not_found: "No reservation was found.",
	not_found: "Nothing was found at this address.",
	sale_not_started: "The sale has not started yet.",
	sale_ended: "The sale has ended.",
	sold_out: "No items are left.",
	hold_expired: "The hold has ended.",
	already_purchased: "The shopper has already bought an item.",
	sale_overlaps: "Another sale already uses part of this time.",
	rate_limited: "Too many requests. Try again later.",
	internal: "Something went wrong on the server.",
	backend_unavailable: "The API could not be reached.",
	unavailable: "The service cannot take this request now. Try again later.",
} as const satisfies Record<ErrorCode, string>;

// The two failures a client sees without any reply from the server.
export const CLIENT_FAILURE_MESSAGE = {
	network: "The server could not be reached.",
	unexpected: "The server sent a reply that the contract does not allow.",
} as const;

// The body of every error reply: the code, and its sentence. The status is not in the body; it is `ERROR_STATUS[code]`.
export type ErrorPayload<C extends ErrorCode = ErrorCode> = {
	errorCode: C;
	errorMessage: string;
};

export function errorPayload<const C extends ErrorCode>(
	code: C,
): ErrorPayload<C> {
	return { errorCode: code, errorMessage: ERROR_MESSAGE[code] };
}

// The statuses of a success. An error is answered with `ERROR_STATUS[code]`, never with a number written by hand.
export const HTTP_STATUS = {
	ok: 200,
	created: 201,
} as const;

// The first status of each class of failure, to tell a refusal from a fault.
export const FIRST_CLIENT_ERROR_STATUS = 400;
export const FIRST_SERVER_ERROR_STATUS = 500;

// One name for the thousand that turns seconds into milliseconds, so no file writes it by hand.
export const MS_PER_SECOND = 1000;

// The codes each operation may answer with.
export const JOIN_ERRORS = [
	"sale_not_found",
	"invalid_user",
	"sale_ended",
	"sold_out",
] as const;
export const CHECK_ERRORS = [
	"sale_not_found",
	"invalid_user",
	"invalid_ticket",
	"not_in_queue",
] as const;
export const RESERVE_ERRORS = [
	"sale_not_found",
	"invalid_user",
	"invalid_ticket",
	"not_admitted",
	"sale_not_started",
	"sale_ended",
	"sold_out",
	"already_purchased",
	"unavailable",
] as const;
export const CONFIRM_ERRORS = [
	"sale_not_found",
	"invalid_user",
	"invalid_reservation",
	"reservation_not_found",
	"hold_expired",
	"already_purchased",
	"sale_ended",
	"sold_out",
	"payment_failed",
] as const;
export const OUTCOME_ERRORS = ["sale_not_found", "invalid_user"] as const;
// Creating a sale. `not_found` is how the admin routes answer when no token is set: they look like they are not there.
export const ADMIN_ERRORS = [
	"not_found",
	"invalid_admin_token",
	"invalid_sale",
	"sale_overlaps",
] as const;

// A request body field that is missing or not a string is refused with the code of that field.
export const FIELD_ERROR = {
	userId: "invalid_user",
	reservationId: "invalid_reservation",
} as const;
