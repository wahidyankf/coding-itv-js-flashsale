// The words of the HTTP side of the API: header names, statuses, and the error codes with their sentences. Inbound HTTP
// adapter. The rules that raise these errors are in the domain and the application, not here.

// The header that carries the queue ticket. A ticket is sent in it, and nowhere else.
export const TICKET_HEADER = "x-queue-ticket";

// The success statuses the routes use: 200 for a read or a change, 201 for something new.
export const HTTP_STATUS = { ok: 200, created: 201 } as const;
// The first status of the client-error range (4xx): a request the client got wrong.
export const FIRST_CLIENT_ERROR_STATUS = 400;
// The first status of the server-error range (5xx): our fault, logged and answered as `internal`.
export const FIRST_SERVER_ERROR_STATUS = 500;

// Every error code of the API and the HTTP status that answers it. A code has one status everywhere.
export const ERROR_STATUS = {
	invalid_user: 400,
	invalid_reservation: 400,
	invalid_request: 400,
	invalid_sale: 400,
	invalid_password: 400,
	invalid_ticket: 401,
	invalid_credentials: 401,
	invalid_refresh_token: 401,
	not_authenticated: 401,
	payment_failed: 402,
	not_admitted: 403,
	forbidden: 403,
	sale_not_found: 404,
	product_not_found: 404,
	not_in_queue: 404,
	reservation_not_found: 404,
	not_found: 404,
	sale_not_started: 409,
	sale_ended: 409,
	sold_out: 409,
	hold_expired: 409,
	already_purchased: 409,
	username_taken: 409,
	sale_overlaps: 409,
	sale_locked: 409,
	sale_has_purchases: 409,
	rate_limited: 429,
	internal: 500,
	unavailable: 503,
} as const;

// Every error code the API can answer with. Adding a code means adding it to ERROR_STATUS and ERROR_MESSAGE.
export type ErrorCode = keyof typeof ERROR_STATUS;

// One sentence for each error code, for a developer reading a reply or a log. `internal` says nothing of the cause.
const ERROR_MESSAGE = {
	invalid_user: "The user id is missing or not valid.",
	invalid_reservation: "The reservation id is missing or not valid.",
	invalid_request: "The request could not be read.",
	invalid_sale: "The sale is not valid.",
	invalid_password: "The password must have 8 to 128 characters.",
	invalid_ticket: "The queue ticket is missing or not valid.",
	invalid_credentials: "The user name or the password is wrong.",
	invalid_refresh_token:
		"The refresh token is missing, expired or already used.",
	not_authenticated: "You are not logged in.",
	payment_failed: "The payment did not go through.",
	not_admitted: "The shopper has not been admitted yet.",
	forbidden: "This account is not allowed to do this.",
	sale_not_found: "No sale was found.",
	product_not_found: "No product was found.",
	not_in_queue: "The shopper is not in the queue.",
	reservation_not_found: "No reservation was found.",
	not_found: "Nothing was found at this address.",
	sale_not_started: "The sale has not started yet.",
	sale_ended: "The sale has ended.",
	sold_out: "No items are left.",
	hold_expired: "The hold has ended.",
	already_purchased: "The shopper has already bought an item.",
	username_taken: "This user name is already taken.",
	sale_overlaps: "Another sale already uses part of this time.",
	sale_locked: "The sale has started or ended, so this change is not allowed.",
	sale_has_purchases: "The sale has purchases, so it cannot be removed.",
	rate_limited: "Too many requests. Try again later.",
	internal: "Something went wrong on the server.",
	unavailable: "The service cannot take this request now. Try again later.",
} as const satisfies Record<ErrorCode, string>;

// The body of every error reply. The status is not in the body; it is `ERROR_STATUS[code]`.
export function errorPayload(code: ErrorCode) {
	return { errorCode: code, errorMessage: ERROR_MESSAGE[code] };
}
