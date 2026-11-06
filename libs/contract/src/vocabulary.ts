// The words of the API that need no schema library: format rules, header names and error codes. The domain of the
// backend imports this file, so it stays free of Zod and of I/O. The schemas and routes are built from it in the
// main entry of the package.

import { type Option, Some } from "@flash/typekit";

// A user id is a short name the shopper types. It is trimmed and lowercased so "Ana " and "ana" are one person.
export const USER_ID_PATTERN = /^[a-z0-9][a-z0-9._@+-]{0,63}$/;

export function normalizeUserId(raw: unknown): Option<string> {
	if (typeof raw !== "string") return undefined;
	const user = raw.trim().toLowerCase();
	return USER_ID_PATTERN.test(user) ? new Some(user) : undefined;
}

export const UUID_PATTERN =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
	return UUID_PATTERN.test(value);
}

export const TICKET_HEADER = "x-queue-ticket";
export const RETRY_AFTER_HEADER = "retry-after";

export const SALE_STATUSES = [
	"upcoming",
	"active",
	"sold_out",
	"ended",
] as const;
export type SaleStatus = (typeof SALE_STATUSES)[number];

export const PLACE_STATES = ["waiting", "admitted", "absent"] as const;

// Every error code of the API and the HTTP status that answers it. A code has one status everywhere.
export const ERROR_STATUS = {
	invalid_user: 400,
	invalid_reservation: 400,
	invalid_request: 400,
	invalid_ticket: 401,
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
	rate_limited: 429,
	internal: 500,
	backend_unavailable: 502,
	unavailable: 503,
} as const;

export type ErrorCode = keyof typeof ERROR_STATUS;

export function isErrorCode(value: unknown): value is ErrorCode {
	return typeof value === "string" && Object.hasOwn(ERROR_STATUS, value);
}

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

// Answers that do not come from an operation: the edge of the server, the limiter and the web pass-through.
export const COMMON_ERRORS = [
	"invalid_request",
	"rate_limited",
	"not_found",
	"internal",
	"backend_unavailable",
] as const;

// A request body field that is missing or not a string is refused with the code of that field.
export const FIELD_ERROR = {
	userId: "invalid_user",
	reservationId: "invalid_reservation",
} as const;
