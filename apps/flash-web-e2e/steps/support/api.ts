import {
	buildRequest,
	parseReply,
	type Reply,
	type RequestInput,
	type Route,
} from "@flash/contract";
import type { APIRequestContext, APIResponse } from "@playwright/test";

// Sends a request of the contract straight to flash-be, as another client would.
export async function send<R extends Route>(
	request: APIRequestContext,
	baseUrl: string,
	route: R,
	input: RequestInput<R>,
): Promise<APIResponse> {
	const built = buildRequest(route, input, baseUrl);
	return request.fetch(built.url, {
		method: built.method,
		headers: built.headers,
		data: built.body ?? null,
	});
}

// The body of a reply that is not a refusal, or undefined.
export async function bodyOf<R extends Route>(
	route: R,
	response: APIResponse,
): Promise<Reply<R>["body"] | undefined> {
	const reply = parseReply(route, {
		status: response.status(),
		headers: response.headers(),
		text: await response.text(),
	});
	return reply.isOk() ? reply.value.body : undefined;
}
