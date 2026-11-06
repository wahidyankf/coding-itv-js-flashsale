// A request as plain data. It does not depend on fetch, so the same builder serves a browser, a Playwright test and
// k6, which each send it their own way.

import { attempt } from "@flash/typekit";
import {
	type Method,
	type RequestInput,
	type Route,
	routes,
} from "./routes.js";

export type BuiltRequest = {
	method: Method;
	url: string;
	// Lower-case names.
	headers: Record<string, string>;
	body: string | undefined;
};

type Parts = {
	params?: Readonly<Record<string, string>>;
	headers?: Readonly<Record<string, string | undefined>>;
	body?: unknown;
};

// The path of a route with its `:name` parameters filled in and escaped.
export function pathOf(
	route: Pick<Route, "path">,
	params: Readonly<Record<string, string>> = {},
): string {
	return route.path.replace(/:([A-Za-z]+)/g, (_match, name: string) =>
		encodeURIComponent(params[name] ?? ""),
	);
}

export function buildRequest<R extends Route>(
	route: R,
	input: RequestInput<R>,
	baseUrl = "",
): BuiltRequest {
	// The types of RequestInput guarantee these parts, so reading them through one loose view is safe.
	const parts = input as Parts;
	const headers: Record<string, string> = {};
	for (const [name, value] of Object.entries(parts.headers ?? {})) {
		if (value !== undefined) headers[name.toLowerCase()] = value;
	}
	if (parts.body !== undefined) headers["content-type"] = "application/json";
	return {
		method: route.method,
		url: `${baseUrl}${pathOf(route, parts.params)}`,
		headers,
		body: parts.body === undefined ? undefined : JSON.stringify(parts.body),
	};
}

export type Match = { route: Route; params: Record<string, string> };

// Which route a request is for, and the values of its parameters. A route with a fixed path comes before one with a
// parameter in the table, so `/sales/current` is not taken for a sale. A value that cannot be decoded matches nothing.
export function matchRoute(
	method: string,
	path: string,
	candidates: readonly Route[] = Object.values(routes),
): Match | undefined {
	for (const route of candidates) {
		if (route.method !== method) continue;
		const pattern = route.path.replace(/:([A-Za-z]+)/g, "(?<$1>[^/]+)");
		const found = new RegExp(`^${pattern}$`).exec(path);
		if (!found) continue;
		const params: Record<string, string> = {};
		for (const [name, value] of Object.entries(found.groups ?? {})) {
			const decoded = attempt(() => decodeURIComponent(value), URIError);
			if (decoded.isErr()) return undefined;
			params[name] = decoded.value;
		}
		return { route, params };
	}
	return undefined;
}
