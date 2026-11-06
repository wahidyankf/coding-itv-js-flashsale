// Reads a reply against the route that was called. A reply either is one the route declares, or is a failure with a
// name. Nothing is cast, and nothing throws.

import { attempt, Err, Ok, type Result } from "@flash/typekit";
import type { Reply, Route } from "./routes.js";
import { ErrorBody } from "./schemas.js";
import {
	ERROR_STATUS,
	type ErrorCode,
	RETRY_AFTER_HEADER,
} from "./vocabulary.js";

// What a transport hands over: the status, the headers and the body text.
export type RawReply = {
	status: number;
	headers: Readonly<Record<string, string | undefined>>;
	text: string;
};

// The API refused (`error` is one of its codes), nothing answered (`network`), or the answer broke the contract
// (`unexpected`).
export type ApiFailure = {
	error: ErrorCode | "network" | "unexpected";
	status?: number | undefined;
	retryAfterSeconds?: number | undefined;
};

function headerOf(
	headers: RawReply["headers"],
	name: string,
): string | undefined {
	for (const [key, value] of Object.entries(headers)) {
		if (key.toLowerCase() === name) return value;
	}
	return undefined;
}

function retryAfter(raw: RawReply, body: unknown): number | undefined {
	const header = Number(headerOf(raw.headers, RETRY_AFTER_HEADER));
	if (Number.isFinite(header)) return header;
	if (
		typeof body === "object" &&
		body !== null &&
		"retryAfterSeconds" in body
	) {
		const seconds = Number(body.retryAfterSeconds);
		if (Number.isFinite(seconds)) return seconds;
	}
	return undefined;
}

function refusal(raw: RawReply, body: unknown): ApiFailure | undefined {
	const parsed = ErrorBody.safeParse(body);
	if (!parsed.success || raw.status < 400) return undefined;
	if (ERROR_STATUS[parsed.data.error] !== raw.status) return undefined;
	return {
		error: parsed.data.error,
		status: raw.status,
		retryAfterSeconds: retryAfter(raw, body),
	};
}

export function parseReply<R extends Route>(
	route: R,
	raw: RawReply,
): Result<Reply<R>, ApiFailure> {
	const unexpected: ApiFailure = { error: "unexpected", status: raw.status };
	const json = attempt(() => JSON.parse(raw.text) as unknown, SyntaxError);
	if (json.isErr()) return new Err(unexpected);
	const body = json.value;

	const refused = refusal(raw, body);
	if (refused) return new Err(refused);

	const schema = route.replies[raw.status];
	if (schema === undefined) return new Err(unexpected);
	const parsed = schema.safeParse(body);
	if (!parsed.success) return new Err(unexpected);
	// The status is a key of route.replies and the body passed its schema, so this is one of the route's replies.
	return new Ok({ status: raw.status, body: parsed.data } as Reply<R>);
}
