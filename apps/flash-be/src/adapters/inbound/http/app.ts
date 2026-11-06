import { ERROR_STATUS, type ErrorCode, FIELD_ERROR } from "@flash/contract";
import Fastify, { type FastifyInstance } from "fastify";
import {
	hasZodFastifySchemaValidationErrors,
	serializerCompiler,
	validatorCompiler,
} from "fastify-type-provider-zod";
import type { Dependencies } from "../../../application/dependencies.js";
import { DEFAULT_STREAM_OPTIONS, type StreamOptions } from "./event-stream.js";
import { registerRoutes } from "./routes.js";

export function buildApp(
	deps: Dependencies,
	options: {
		logger?: boolean;
		trustProxy?: boolean;
		events?: StreamOptions;
	} = {},
): FastifyInstance {
	const app = Fastify({
		logger: options.logger ?? false,
		trustProxy: options.trustProxy ?? false,
		// Open event streams must not keep the server from closing.
		forceCloseConnections: true,
	});
	applyContract(app);

	registerRoutes(app, deps, options.events ?? DEFAULT_STREAM_OPTIONS);
	return app;
}

// The schemas of @flash/contract check every request and every reply. A reply that breaks the contract is a bug, so it
// is answered with `internal` and logged. Every error has the same body, `{ error: code }`, whatever raised it.
export function applyContract(app: FastifyInstance): void {
	app.setValidatorCompiler(validatorCompiler);
	app.setSerializerCompiler(serializerCompiler);

	const refuse = (code: ErrorCode) => ({
		status: ERROR_STATUS[code],
		body: { error: code },
	});
	app.setNotFoundHandler((_request, reply) => {
		const { status, body } = refuse("not_found");
		return reply.code(status).send(body);
	});
	app.setErrorHandler((error, request, reply) => {
		const { status, body } = refuse(errorCodeOf(error));
		if (status >= 500) request.log.error({ err: error }, "request failed");
		return reply.code(status).send(body);
	});
}

// A body that is missing a field, or has it in the wrong type, is refused with the code of that field. Anything else
// the client got wrong (broken JSON, too large, wrong media type) is `invalid_request`. The rest is our fault.
function errorCodeOf(error: unknown): ErrorCode {
	if (hasZodFastifySchemaValidationErrors(error)) {
		if (error.validationContext !== "body") return "invalid_request";
		const field = error.validation[0]?.instancePath.split("/")[1];
		return field === "reservationId"
			? FIELD_ERROR.reservationId
			: FIELD_ERROR.userId;
	}
	const status = (error as { statusCode?: unknown }).statusCode;
	return typeof status === "number" && status >= 400 && status < 500
		? "invalid_request"
		: "internal";
}
