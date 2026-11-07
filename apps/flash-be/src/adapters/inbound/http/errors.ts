// The error codes of the HTTP API with their statuses and sentences (inbound HTTP adapter). The standard status numbers
// come from @flash/flash-commons (HTTP_STATUS); this file owns only which code answers with which status. The rules that
// raise these errors are in the domain and the application, not here.
import { HTTP_STATUS } from "@flash/flash-commons";
import {
	PASSWORD_MAX_LENGTH,
	PASSWORD_MIN_LENGTH,
} from "../../../domain/auth.js";

// Every error code of the API and the HTTP status that answers it. A code has one status everywhere.
export const ERROR_STATUS = {
	invalid_user: HTTP_STATUS.badRequest,
	invalid_reservation: HTTP_STATUS.badRequest,
	invalid_request: HTTP_STATUS.badRequest,
	invalid_sale: HTTP_STATUS.badRequest,
	invalid_password: HTTP_STATUS.badRequest,
	invalid_ticket: HTTP_STATUS.unauthorized,
	invalid_credentials: HTTP_STATUS.unauthorized,
	invalid_refresh_token: HTTP_STATUS.unauthorized,
	not_authenticated: HTTP_STATUS.unauthorized,
	payment_failed: HTTP_STATUS.paymentRequired,
	not_admitted: HTTP_STATUS.forbidden,
	forbidden: HTTP_STATUS.forbidden,
	sale_not_found: HTTP_STATUS.notFound,
	product_not_found: HTTP_STATUS.notFound,
	not_in_queue: HTTP_STATUS.notFound,
	reservation_not_found: HTTP_STATUS.notFound,
	not_found: HTTP_STATUS.notFound,
	sale_not_started: HTTP_STATUS.conflict,
	sale_ended: HTTP_STATUS.conflict,
	sold_out: HTTP_STATUS.conflict,
	hold_expired: HTTP_STATUS.conflict,
	already_purchased: HTTP_STATUS.conflict,
	username_taken: HTTP_STATUS.conflict,
	sale_overlaps: HTTP_STATUS.conflict,
	sale_locked: HTTP_STATUS.conflict,
	sale_has_purchases: HTTP_STATUS.conflict,
	rate_limited: HTTP_STATUS.tooManyRequests,
	internal: HTTP_STATUS.internalServerError,
	unavailable: HTTP_STATUS.serviceUnavailable,
} as const;

// Every error code the API can answer with. Adding a code means adding it to ERROR_STATUS and ERROR_MESSAGE.
export type ErrorCode = keyof typeof ERROR_STATUS;

// One sentence for each error code, for a developer reading a reply or a log. `internal` says nothing of the cause.
const ERROR_MESSAGE = {
	invalid_user: "The user id is missing or not valid.",
	invalid_reservation: "The reservation id is missing or not valid.",
	invalid_request: "The request could not be read.",
	invalid_sale: "The sale is not valid.",
	invalid_password: `The password must have ${PASSWORD_MIN_LENGTH} to ${PASSWORD_MAX_LENGTH} characters.`,
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
