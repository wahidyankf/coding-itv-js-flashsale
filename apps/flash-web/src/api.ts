// Browser and server. The web app's view of flash-be's HTTP API: header names, the failure type and `callApi`. The page and its clients
// use it. Every API error is `{ errorCode, errorMessage }`, plus `retryAfterSeconds` on a rate limit.
import {
	type DecodeError,
	type Decoder,
	integer,
	object,
	optional,
	text,
} from "@flash/flash-commons";
import { attempt, attemptAsync, Err, Ok, type Result } from "@flash/typekit";
import { type Reporter, reportDecodeFailure } from "./decode-report";

// The header that carries the queue ticket. The page sends it, and the proxy passes it on.
export const TICKET_HEADER = "x-queue-ticket";
// The header that tells the page how long to wait after a rate limit.
export const RETRY_AFTER_HEADER = "retry-after";
// The type of a JSON body, as the API expects it on every POST.
export const JSON_CONTENT_TYPE = "application/json";

// `errorCode` is a code of the API, or `network` or `unexpected`, which only this app sets.
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

// The body of every refusal. The wait is in whole seconds. The header wins over this field (see `retryAfter`).
// A body with a field of the wrong type is a reply this app cannot read, so it is not shown as a refusal.
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

// The one place a body is parsed, so a bad body becomes a value and never a throw. A text that is not JSON gives a
// SyntaxError; a value that does not decode gives a DecodeError that names the field.
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

// Reports a body that decoded to an error. A body that is not JSON has no field to name, so it is not reported.
function reportUnreadable(
	report: Reporter,
	source: string,
	error: DecodeError | SyntaxError,
): void {
	if (error instanceof SyntaxError) return;
	report({ source, path: error.path, expected: error.expected });
}

// One request, read into a `Result`. A body that does not decode becomes "unexpected", so the page never shows a value of
// the wrong shape. Each such body goes once to `report`, with the URL and the field, so a developer can see the fault.
export async function callApi<T>(
	fetcher: typeof fetch,
	url: string,
	decode: Decoder<T>,
	init: RequestInit = {},
	report: Reporter = reportDecodeFailure,
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
		if (decoded.isOk()) return new Ok(decoded.value);
		reportUnreadable(report, url, decoded.error);
		return new Err(UNEXPECTED);
	}

	const refusal = readBody(body, decodeRefusal);
	if (refusal.isErr()) {
		reportUnreadable(report, url, refusal.error);
		return new Err(UNEXPECTED);
	}
	return new Err({
		errorCode: refusal.value.errorCode,
		errorMessage: refusal.value.errorMessage,
		retryAfterSeconds: retryAfter(wait, refusal.value.retryAfterSeconds),
	});
}
