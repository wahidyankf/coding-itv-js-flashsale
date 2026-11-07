// One request to the app, as a step sends it. Every layer and every binding sends requests through it, so the method,
// the cookie header and the JSON body are the same bytes whichever layer runs the scenario.
import type { FastifyInstance } from "fastify";
import type { Response } from "./response.js";

// The HTTP methods a step may send. The app is only ever called with these, so a step cannot send another verb by mistake.
export type Method = "GET" | "POST" | "PATCH" | "DELETE";

// Sends one request to `app`. A payload goes as JSON with its content type; no cookie is sent when none is given.
export function sendRequest(
	app: FastifyInstance,
	method: Method,
	url: string,
	options: { cookie?: string | undefined; payload?: unknown } = {},
): Promise<Response> {
	const hasPayload = options.payload !== undefined;
	return app.inject({
		method,
		url,
		headers: {
			...(options.cookie === undefined ? {} : { cookie: options.cookie }),
			...(hasPayload ? { "content-type": "application/json" } : {}),
		},
		...(hasPayload ? { payload: JSON.stringify(options.payload) } : {}),
	});
}
