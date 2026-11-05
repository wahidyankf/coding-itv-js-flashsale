import Fastify, { type FastifyInstance } from "fastify";
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
	registerRoutes(app, deps, options.events ?? DEFAULT_STREAM_OPTIONS);
	return app;
}
