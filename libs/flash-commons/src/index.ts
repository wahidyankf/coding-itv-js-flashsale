// The public surface of @flash/flash-commons. Each module is re-exported here, so a caller imports from one place.
// Only the names below are public; a module's helpers stay private to it.

// The cookie jar the apps' tests use, so a test sends the cookies a browser would. A jar is a value; each function returns a new one.
export {
	applySetCookies,
	type CookieJar,
	cookieHeader,
	cookieHeaderOf,
	parseSetCookie,
	type SetCookie,
	type StoredCookie,
} from "./cookies.js";
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
// Reads the scenarios' time phrases against a moment the caller picks, so every layer reads a phrase the same way.
export { relativeTime } from "./relative-time.js";
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
// The UUID check that flash-be's domain and flash-web's proxy share: the form of a sale, reservation or product id.
export { isUuid } from "./uuid.js";
