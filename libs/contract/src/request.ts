// A request as plain data. It does not depend on fetch, so the same builder serves a browser, a Playwright test and
// k6, which each send it their own way.

import type { Method, RequestInput, Route } from "./routes.js";

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
