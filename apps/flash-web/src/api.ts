// What the web app knows about the HTTP API of flash-be: the header names, the failure a reply can carry, and `callApi`,
// the one call that turns a reply into a `Result`. Every error of the API has the shape `{ errorCode, errorMessage }`,
// plus `retryAfterSeconds` on a rate limit. Every reply is decoded before the page uses it.
import {
	type DecodeError,
	type Decoder,
	integer,
	object,
	optional,
	text,
} from "@flash/flash-commons";
import { attempt, attemptAsync, Err, Ok, type Result } from "@flash/typekit";

// The header that carries the queue ticket. The page sends it, and the proxy passes it on.
export const TICKET_HEADER = "x-queue-ticket";
// The header that tells the page how long to wait after a rate limit.
export const RETRY_AFTER_HEADER = "retry-after";
// The type of a JSON body, as the API expects it on every POST.
export const JSON_CONTENT_TYPE = "application/json";

// `errorCode` is a code of the API, or `network` or `unexpected`, which only this app makes up.
export type ApiFailure = {
	errorCode: string;
	errorMessage: string;
	retryAfterSeconds?: number | undefined;
};

// An answer from the API: the body, or why there is none.
export type ApiResult<T> = Result<T, ApiFailure>;

const NETWORK: ApiFailure = {
	errorCode: "network",
	errorMessage: "The server could not be reached.",
};
const UNEXPECTED: ApiFailure = {
	errorCode: "unexpected",
	errorMessage: "The server sent a reply that this app cannot read.",
};

// The body of every refusal. The wait is whole seconds, as the API counts them; the header that carries it wins (see
// `retryAfter`). A body with a field of the wrong type is a reply this app cannot read, not a refusal it can show.
export const decodeRefusal = object({
	errorCode: text,
	errorMessage: text,
	retryAfterSeconds: optional(integer),
});

// A POST whose body is JSON. The caller passes the body already as text: "{}" when there is nothing to send.
export function jsonPost(
	body: string,
	headers: Record<string, string> = {},
): RequestInit {
	return {
		method: "POST",
		headers: { "content-type": JSON_CONTENT_TYPE, ...headers },
		body,
	};
}

// Reads the text of a body as JSON, then checks the value with the decoder. A text that is not JSON gives a SyntaxError;
// a value that does not decode gives a DecodeError that names the field.
export function readBody<T>(
	body: string,
	decode: Decoder<T>,
): Result<T, DecodeError | SyntaxError> {
	const json = attempt(() => JSON.parse(body) as unknown, SyntaxError);
	if (json.isErr()) return new Err(json.error);
	return decode(json.value);
}

// The wait the API asks for: the header first, then the body. A header that is not a number does not count.
function retryAfter(
	header: string | null,
	fromBody: number | undefined,
): number | undefined {
	const fromHeader = header === null ? Number.NaN : Number(header);
	return Number.isFinite(fromHeader) ? fromHeader : fromBody;
}

// One request. A 2xx reply is the `T` the caller names only when `decode` accepts its body; a reply that does not decode is
// "unexpected", the same as a reply that is not JSON, so the page never shows a value of the wrong shape. A refusal is read
// with `decodeRefusal`, and one that does not decode is "unexpected" too.
export async function callApi<T>(
	fetcher: typeof fetch,
	url: string,
	decode: Decoder<T>,
	init: RequestInit = {},
): Promise<ApiResult<T>> {
	const sent = await attemptAsync(async () => {
		const reply = await fetcher(url, init);
		return {
			ok: reply.ok,
			wait: reply.headers.get(RETRY_AFTER_HEADER),
			body: await reply.text(),
		};
	}, Error);
	if (sent.isErr()) return new Err(NETWORK);

	const { ok, wait, body } = sent.value;
	if (ok) {
		const decoded = readBody(body, decode);
		return decoded.isOk() ? new Ok(decoded.value) : new Err(UNEXPECTED);
	}

	const refusal = readBody(body, decodeRefusal);
	if (refusal.isErr()) return new Err(UNEXPECTED);
	return new Err({
		errorCode: refusal.value.errorCode,
		errorMessage: refusal.value.errorMessage,
		retryAfterSeconds: retryAfter(wait, refusal.value.retryAfterSeconds),
	});
}
