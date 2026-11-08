// The HTTP server of flash-be (inbound HTTP adapter), built on Fastify. It turns a request into a call on the application
// and a result into a reply. The routes are in ./routes, the error replies in ./errors.ts.

import { randomUUID } from "node:crypto";
import type { IncomingMessage } from "node:http";
import {
	FIRST_ERROR_STATUS,
	FIRST_SERVER_ERROR_STATUS,
	isUuid,
} from "@flash/flash-commons";
import Fastify, { type FastifyBaseLogger, type FastifyInstance } from "fastify";
import { type Logger as PinoLogger, pino } from "pino";
import type { Dependencies } from "../../../application/dependencies.js";
import { ERROR_STATUS, type ErrorCode, errorPayload } from "./errors.js";
import {
	createOpenStreams,
	DEFAULT_STREAM_OPTIONS,
	type StreamOptions,
} from "./event-stream.js";
import { REQUEST_ID_HEADER } from "./headers.js";
import { registerRoutes } from "./routes/index.js";

// Where the log goes and how much of it. Lines are JSON, one per request and one per reply, plus the events an operator
// acts on. `stream` is for a test that reads the lines; the server writes to standard output.
export type LogSettings = {
	// A pino level: fatal, error, warn, info, debug, trace or silent. config.ts checks it.
	level: string;
	stream?: { write: (line: string) => void };
};

// The parts of a line that could hold a token, hidden in case a serializer ever logs the headers. The default serializers
// log the method, the path and the status only, and a body is never logged.
const REDACTED_PATHS = [
	"req.headers.cookie",
	"req.headers.authorization",
	'res.headers["set-cookie"]',
];

// The id of a request: the caller's own id when it is a UUID, so one request can be followed from flash-web through nginx
// to this instance; a new UUID otherwise, so a caller cannot write what it likes into the log.
function requestIdOf(request: IncomingMessage): string {
	const sent = request.headers[REQUEST_ID_HEADER];
	return typeof sent === "string" && isUuid(sent) ? sent : randomUUID();
}

// The log for these settings, with the paths that could hold a token hidden. main.ts makes it before anything else, so
// the config line is out before Redis is connected, and gives the same instance to the app, so no line skips the hiding.
export function createLogger(settings: LogSettings): PinoLogger {
	const options = {
		level: settings.level,
		redact: { paths: REDACTED_PATHS, censor: "[redacted]" },
	};
	return settings.stream === undefined
		? pino(options)
		: pino(options, settings.stream);
}

// Builds the app without listening, so a test can run it without a port. The entry point or a test sets the options.
export function buildApp(
	deps: Dependencies,
	options: {
		// From createLogger. No log when left out, as in most tests.
		logger?: FastifyBaseLogger;
		trustProxy?: boolean;
		events?: StreamOptions;
		// Cookies for HTTPS only. On in production; off only for plain HTTP, where a browser would not send them back.
		cookieSecure: boolean;
		// True once the process was asked to stop. Readiness then answers 503. Never true when left out.
		isStopping?: () => boolean;
	},
): FastifyInstance {
	const app = Fastify({
		...(options.logger === undefined
			? { logger: false }
			: { loggerInstance: options.logger }),
		// The header is read in requestIdOf, not by Fastify, which would take any value it holds.
		requestIdHeader: false,
		genReqId: requestIdOf,
		trustProxy: options.trustProxy ?? false,
		// A close drops only idle connections and waits for the requests in flight. The open event streams are ended
		// below, before the server closes, so they cannot hold it open.
		forceCloseConnections: "idle",
		// A request that still reaches a closing server is answered as usual, so every error keeps the API's body.
		return503OnClosing: false,
	});
	const isStopping = options.isStopping ?? (() => false);
	const open = createOpenStreams();
	answerErrors(app);
	closeGracefully(app, isStopping, open.endAll);

	registerRoutes(
		app,
		deps,
		{ ...(options.events ?? DEFAULT_STREAM_OPTIONS), open },
		{ secure: options.cookieSecure, isStopping },
	);
	return app;
}

// Every reply carries the id of its request. While the app stops, every reply also tells the client to close its connection, so its next request opens a new one, which
// the balancer sends to an instance that is still running. When the app closes, the open streams end first.
function closeGracefully(
	app: FastifyInstance,
	isStopping: () => boolean,
	endStreams: () => void,
): void {
	app.addHook("onSend", async (request, reply, payload) => {
		// Every reply names its request, error replies too, so a shopper can quote it and an operator find its lines.
		reply.header(REQUEST_ID_HEADER, request.id);
		if (isStopping()) reply.header("connection", "close");
		return payload;
	});
	app.addHook("preClose", async () => {
		endStreams();
	});
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
