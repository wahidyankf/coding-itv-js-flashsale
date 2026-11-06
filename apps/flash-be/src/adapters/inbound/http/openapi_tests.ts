import { routes } from "@flash/contract";
import { describe, expect, it } from "vitest";
import { unusedDependencies } from "../../../openapi-deps.js";
import { buildOpenApi } from "./openapi.js";

type Operation = {
	operationId: string;
	summary: string;
	responses: Record<string, { description: string; content?: object }>;
};
type Document = {
	openapi: string;
	paths: Record<string, Record<string, Operation>>;
};

const document = (await buildOpenApi(unusedDependencies)) as Document;
const operations = Object.entries(document.paths).flatMap(([path, methods]) =>
	Object.entries(methods).map(([method, operation]) => ({
		path,
		method,
		operation,
	})),
);

describe("the OpenAPI document", () => {
	it("describes exactly the routes of the table, with OpenAPI path syntax", () => {
		const expected = Object.values(routes).map(
			(route) =>
				`${route.method} ${route.path.replace(/:([A-Za-z]+)/g, "{$1}")}`,
		);
		const actual = operations.map(
			({ path, method }) => `${method.toUpperCase()} ${path}`,
		);
		expect(actual.sort()).toEqual(expected.sort());
	});

	it("names each operation after its route and gives it the summary of the table", () => {
		for (const route of Object.values(routes)) {
			const found = operations.find(
				({ operation }) => operation.operationId === route.name,
			);
			expect(found?.operation.summary).toBe(route.summary);
		}
	});

	it("lists every status of a route", () => {
		for (const route of Object.values(routes)) {
			const found = operations.find(
				({ operation }) => operation.operationId === route.name,
			);
			expect(Object.keys(found?.operation.responses ?? {}).sort()).toEqual(
				Object.keys(route.replies).sort(),
			);
		}
	});

	it("describes a stream as text/event-stream and any other reply as JSON", () => {
		for (const route of Object.values(routes)) {
			const found = operations.find(
				({ operation }) => operation.operationId === route.name,
			);
			const ok = found?.operation.responses["200"];
			expect(Object.keys(ok?.content ?? {})).toEqual([
				route.stream ? "text/event-stream" : "application/json",
			]);
		}
	});

	it("gives every reply a description", () => {
		for (const { operation } of operations) {
			for (const reply of Object.values(operation.responses)) {
				expect(reply.description).not.toBe("Default Response");
			}
		}
	});
});
