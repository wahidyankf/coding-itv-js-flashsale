// The replies that every route shares: an error, a result, and a success that may have created something. A route answers
// through these, so the status of each error code is chosen in one place (errors.ts). Inbound HTTP adapter.

import { HTTP_STATUS } from "@flash/flash-commons";
import type { Result } from "@flash/typekit";
import type { FastifyReply } from "fastify";
import { ERROR_STATUS, type ErrorCode, errorPayload } from "../errors.js";

// The error reply: its status, and the `{ errorCode, errorMessage }` body. The status is `ERROR_STATUS[code]`.
export function sendError(reply: FastifyReply, code: ErrorCode): FastifyReply {
	return reply.code(ERROR_STATUS[code]).send(errorPayload(code));
}

// The reply to a result: the error when it failed, otherwise what `onOk` builds from the value.
export function sendResult<T, E extends ErrorCode>(
	reply: FastifyReply,
	result: Result<T, E>,
	onOk: (value: T) => FastifyReply,
): FastifyReply {
	return result.isErr() ? sendError(reply, result.error) : onOk(result.value);
}

// A success that made something answers 201. A retry that finds it already there answers 200, with the same body.
export function createdOrOk(
	reply: FastifyReply,
	created: boolean,
): FastifyReply {
	return reply.code(created ? HTTP_STATUS.created : HTTP_STATUS.ok);
}
