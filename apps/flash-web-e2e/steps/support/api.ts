// The HTTP helpers of the web e2e steps: the path of a sale, and the calls made with the Playwright request context or with
// fetch. The ticket header is not repeated here; it is defined once, in flash-be-e2e's support/api.ts.

import type { APIRequestContext } from "@playwright/test";

// The path of a sale on the API, as the routes write it.
export const salePath = (saleId: string | undefined) =>
	`/sales/${saleId ?? ""}`;

// A JSON POST with the Playwright request context. The body is sent as JSON, with the headers given.
export const postJson = (
	request: APIRequestContext,
	url: string,
	body: object,
	headers: Record<string, string> = {},
) => request.post(url, { data: body, headers });

// A GET with the Playwright request context and the headers given.
export const getJson = (
	request: APIRequestContext,
	url: string,
	headers: Record<string, string> = {},
) => request.get(url, { headers });

// A JSON request with fetch, for the calls that do not go through a Playwright request: the login of a user and the
// operator's requests. Extra headers, such as the cookie, are added to the JSON headers.
export function fetchJson(
	method: "POST" | "PATCH",
	url: string,
	body: object,
	headers: Record<string, string> = {},
): Promise<Response> {
	return fetch(url, {
		method,
		headers: { "content-type": "application/json", ...headers },
		body: JSON.stringify(body),
	});
}
