// The HTTP server of flash-be (inbound HTTP adapter), built on Fastify. It turns a request into a call on the application
// and a result into a reply. The routes are in ./routes, the error replies in ./errors.ts.

import {
	FIRST_ERROR_STATUS,
	FIRST_SERVER_ERROR_STATUS,
} from "@flash/flash-commons";
import Fastify, { type FastifyInstance } from "fastify";
import type { Dependencies } from "../../../application/dependencies.js";
import { ERROR_STATUS, type ErrorCode, errorPayload } from "./errors.js";
import { DEFAULT_STREAM_OPTIONS, type StreamOptions } from "./event-stream.js";
import { registerRoutes } from "./routes/index.js";

// Builds the app without listening, so a test can run it without a port. The entry point or a test sets the options.
export function buildApp(
	deps: Dependencies,
	options: {
		logger?: boolean;
		trustProxy?: boolean;
		events?: StreamOptions;
		// Cookies for HTTPS only. On in production; off only for plain HTTP, where a browser would not send them back.
		cookieSecure: boolean;
	},
): FastifyInstance {
	const app = Fastify({
		logger: options.logger ?? false,
		trustProxy: options.trustProxy ?? false,
		// Open event streams must not keep the server from closing.
		forceCloseConnections: true,
	});
	answerErrors(app);

	registerRoutes(app, deps, options.events ?? DEFAULT_STREAM_OPTIONS, {
		secure: options.cookieSecure,
	});
	return app;
}

// The HTTP status an error carries, when it carries one. Fastify sets it on the errors it raises for a bad request.
function statusOf(error: unknown): number | undefined {
	if (typeof error !== "object" || error === null) return undefined;
	if (!("statusCode" in error)) return undefined;
	return typeof error.statusCode === "number" ? error.statusCode : undefined;
}

// Every error has the same body, `{ errorCode, errorMessage }`, whatever raised it. A request the client got wrong (broken
// JSON, too large, wrong media type) is `invalid_request`. The rest is our fault: it is answered with `internal` and
// logged, and the cause is not sent.
function answerErrors(app: FastifyInstance): void {
	const refuse = (code: ErrorCode) => ({
		status: ERROR_STATUS[code],
		body: errorPayload(code),
	});
	app.setNotFoundHandler((_request, reply) => {
		const { status, body } = refuse("not_found");
		return reply.code(status).send(body);
	});
	app.setErrorHandler((error, request, reply) => {
		const status = statusOf(error);
		const code =
			status !== undefined &&
			status >= FIRST_ERROR_STATUS &&
			status < FIRST_SERVER_ERROR_STATUS
				? "invalid_request"
				: "internal";
		const answer = refuse(code);
		if (answer.status >= FIRST_SERVER_ERROR_STATUS)
			request.log.error({ err: error }, "request failed");
		return reply.code(answer.status).send(answer.body);
	});
}
