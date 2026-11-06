// The words of the HTTP side of the API: header names, statuses, and the error codes with their sentences.

export const TICKET_HEADER = "x-queue-ticket";
export const ADMIN_AUTH_HEADER = "authorization";

export const HTTP_STATUS = { ok: 200, created: 201 } as const;
export const FIRST_CLIENT_ERROR_STATUS = 400;
export const FIRST_SERVER_ERROR_STATUS = 500;

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
	unavailable: 503,
} as const;

export type ErrorCode = keyof typeof ERROR_STATUS;

// One sentence for each error code, for a developer reading a reply or a log. `internal` says nothing of the cause.
const ERROR_MESSAGE = {
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
	unavailable: "The service cannot take this request now. Try again later.",
} as const satisfies Record<ErrorCode, string>;

// The body of every error reply. The status is not in the body; it is `ERROR_STATUS[code]`.
export function errorPayload(code: ErrorCode) {
	return { errorCode: code, errorMessage: ERROR_MESSAGE[code] };
}
