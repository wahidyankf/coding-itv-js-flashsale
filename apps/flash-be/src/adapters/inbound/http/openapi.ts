import swagger from "@fastify/swagger";
import { routes } from "@flash/contract";
import { Err } from "@flash/typekit";
import Fastify from "fastify";
import { jsonSchemaTransform } from "fastify-type-provider-zod";
import type { Dependencies } from "../../../application/dependencies.js";
import { applyContract } from "./app.js";
import { DEFAULT_STREAM_OPTIONS } from "./event-stream.js";
import { registerRoutes } from "./routes.js";

// Nothing is called while the document is built, only the routes are registered.
const noSale = async () => undefined;
const unused: Dependencies = {
	checkDatabase: async () => {},
	checkRedis: async () => {},
	sales: { cacheMs: () => 0, current: noSale, byId: noSale, details: noSale },
	queue: {
		join: async () => new Err("sale_not_found"),
		check: async () => new Err("sale_not_found"),
		admitTick: async () => [],
	},
	reservations: { reserve: async () => new Err("sale_not_found") },
	rateLimiter: { check: async () => ({ limited: false }) },
	purchases: {
		confirm: async () => new Err("sale_not_found"),
		outcome: async () => new Err("sale_not_found"),
	},
};

type Operation = {
	responses?: Record<
		string,
		{ description?: string; content?: Record<string, unknown> }
	>;
};
type Document = { paths?: Record<string, Record<string, Operation>> };

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
export async function buildOpenApi(): Promise<object> {
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
	registerRoutes(app, unused, DEFAULT_STREAM_OPTIONS);
	await app.ready();
	// A copy, so the changes below touch no object of the plugin.
	const document = structuredClone(app.swagger()) as Document;
	for (const operations of Object.values(document.paths ?? {})) {
		for (const operation of Object.values(operations)) {
			for (const [status, reply] of Object.entries(operation.responses ?? {})) {
				reply.description = STATUS_TEXT[status] ?? "Reply";
			}
		}
	}
	for (const route of Object.values(routes)) {
		if (!route.stream) continue;
		const path = route.path.replace(/:([A-Za-z]+)/g, "{$1}");
		const ok =
			document.paths?.[path]?.[route.method.toLowerCase()]?.responses?.["200"];
		if (ok?.content)
			ok.content = { "text/event-stream": ok.content["application/json"] };
	}
	await app.close();
	return document;
}
