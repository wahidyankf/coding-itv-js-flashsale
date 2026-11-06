import { attempt, attemptAsync, Err, Ok, type Result } from "@flash/typekit";

// What the web app knows about the HTTP API of flash-be: header names, the few statuses it acts on, and one small call
// that turns a reply into a `Result`. The API answers every error with `{ errorCode, errorMessage }`.
export const TICKET_HEADER = "x-queue-ticket";
export const RETRY_AFTER_HEADER = "retry-after";
export const MS_PER_SECOND = 1000;
export const STATUS = {
	unauthorized: 401,
	notFound: 404,
	badGateway: 502,
} as const;

// `errorCode` is a code of the API, or `network` or `unexpected`, which only this app makes up.
export type ApiFailure = {
	errorCode: string;
	errorMessage: string;
	retryAfterSeconds?: number | undefined;
};

const NETWORK: ApiFailure = {
	errorCode: "network",
	errorMessage: "The server could not be reached.",
};
const UNEXPECTED: ApiFailure = {
	errorCode: "unexpected",
	errorMessage: "The server sent a reply that this app cannot read.",
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null;

// The wait the API asks for: the header first, then the body.
function retryAfter(header: string | null, body: Record<string, unknown>) {
	const fromHeader = header === null ? Number.NaN : Number(header);
	if (Number.isFinite(fromHeader)) return fromHeader;
	const fromBody = Number(body.retryAfterSeconds);
	return Number.isFinite(fromBody) ? fromBody : undefined;
}

// One request. A reply with a 2xx status is trusted to be the `T` the caller names: there is no schema check, because
// flash-be and this app ship together.
export async function callApi<T>(
	fetcher: typeof fetch,
	url: string,
	init: RequestInit = {},
): Promise<Result<T, ApiFailure>> {
	const sent = await attemptAsync(async () => {
		const reply = await fetcher(url, init);
		return {
			ok: reply.ok,
			wait: reply.headers.get(RETRY_AFTER_HEADER),
			text: await reply.text(),
		};
	}, Error);
	if (sent.isErr()) return new Err(NETWORK);

	const { ok, wait, text } = sent.value;
	const json = attempt(() => JSON.parse(text) as unknown, SyntaxError);
	if (json.isErr()) return new Err(UNEXPECTED);
	if (ok) return new Ok(json.value as T);

	const body = json.value;
	if (
		!isRecord(body) ||
		typeof body.errorCode !== "string" ||
		typeof body.errorMessage !== "string"
	) {
		return new Err(UNEXPECTED);
	}
	return new Err({
		errorCode: body.errorCode,
		errorMessage: body.errorMessage,
		retryAfterSeconds: retryAfter(wait, body),
	});
}
