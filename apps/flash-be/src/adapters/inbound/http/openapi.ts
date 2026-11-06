import swagger from "@fastify/swagger";
import { routes } from "@flash/contract";
import Fastify from "fastify";
import { jsonSchemaTransform } from "fastify-type-provider-zod";
import type { Dependencies } from "../../../application/dependencies.js";
import { applyContract } from "./app.js";
import { DEFAULT_STREAM_OPTIONS } from "./event-stream.js";
import { registerRoutes } from "./routes.js";

type Reply = {
	description?: string | undefined;
	content: Record<string, unknown>;
};
// Every reply has a JSON body. A stream answers 200, which is the reply that is rewritten below.
type Operation = { responses: Record<string, Reply> & Record<"200", Reply> };
type Document = { paths: Record<string, Record<string, Operation>> };

const STATUS_TEXT: Record<string, string> = {
	"200": "OK",
	"201": "Created",
	"400": "The request cannot be used",
	"401": "The ticket is not valid",
	"402": "The payment failed",
	"403": "Not admitted",
	"404": "Not found",
	"409": "The sale or the hold does not allow it",
	"429": "Too many requests; wait `retry-after` seconds",
	"500": "A failure inside the server",
	"503": "Not ready, or the hold cannot be taken now",
};

// The OpenAPI document of the API, made from the routes the server registers. A stream is described as
// `text/event-stream`, because that is what its 200 reply is.
// The dependencies are never called: only the routes are registered.
export async function buildOpenApi(deps: Dependencies): Promise<object> {
	const app = Fastify();
	applyContract(app);
	await app.register(swagger, {
		openapi: {
			openapi: "3.1.0",
			info: {
				title: "Flash sale API",
				version: "1.0.0",
				description:
					"Generated from the route table of @flash/contract. Do not edit it by hand: run `npm run openapi:generate`.",
			},
		},
		transform: jsonSchemaTransform,
	});
	registerRoutes(app, deps, DEFAULT_STREAM_OPTIONS);
	await app.ready();
	// A copy, so the changes below touch no object of the plugin. The plugin types every part as optional; the tests
	// check the shape that is used here.
	const document = structuredClone(app.swagger()) as unknown as Document;
	for (const operations of Object.values(document.paths)) {
		for (const operation of Object.values(operations)) {
			// A status that has no text here shows up as a missing description, which the tests refuse.
			for (const [status, reply] of Object.entries(operation.responses)) {
				reply.description = STATUS_TEXT[status];
			}
		}
	}
	const streams = new Set(
		Object.values(routes)
			.filter((route) => route.stream)
			.map(
				(route) =>
					`${route.method} ${route.path.replace(/:([A-Za-z]+)/g, "{$1}")}`,
			),
	);
	for (const [path, operations] of Object.entries(document.paths)) {
		for (const [method, operation] of Object.entries(operations)) {
			if (!streams.has(`${method.toUpperCase()} ${path}`)) continue;
			const ok = operation.responses["200"];
			ok.content = { "text/event-stream": ok.content["application/json"] };
		}
	}
	await app.close();
	return document;
}
