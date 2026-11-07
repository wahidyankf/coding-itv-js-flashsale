// The public surface of @flash/flash-commons. Each module is re-exported here, so a caller imports from one place.
// Only the names below are public; a module's helpers stay private to it.

// The decoder kit for the payloads that cross a process boundary. The apps decode replies and events with these, so a bad
// payload is refused at the edge and never reaches the page or the sale.
export {
	both,
	type DecodeError,
	type Decoder,
	integer,
	isoDate,
	literal,
	nonEmptyText,
	nonNegativeInteger,
	object,
	oneOf,
	optional,
	refine,
	tagged,
	text,
	uuid,
} from "./decode.js";
// The HTTP status numbers by name, and the two lowest error statuses. One copy of each number, so no app writes its own.
export {
	FIRST_ERROR_STATUS,
	FIRST_SERVER_ERROR_STATUS,
	HTTP_STATUS,
} from "./http-status.js";
// Retry with backoff, a max attempt count and full jitter. Every retry in the apps follows this one rule, sync or async.
export {
	type BackoffPolicy,
	backoffDelayMs,
	type RetryAsyncOptions,
	type RetryOptions,
	type RetryPolicy,
	retry,
	retryAsync,
} from "./retry.js";
// The time units, so no app writes 1000 or 60_000 itself.
export { MS_PER_HOUR, MS_PER_MINUTE, MS_PER_SECOND } from "./time.js";
