import {
	type ApiFailure,
	buildRequest,
	parseReply,
	type Reply,
	type RequestInput,
	type Route,
} from "@flash/contract";
import type { Result } from "@flash/typekit";
import type { APIRequestContext, APIResponse } from "@playwright/test";
import { startApi } from "./world.js";

// Sends a request of the contract to the private API of the scenario. The route says the method and the path; the
// input says the rest.
export async function send<R extends Route>(
	request: APIRequestContext,
	route: R,
	input: RequestInput<R>,
): Promise<APIResponse> {
	const built = buildRequest(route, input, await startApi());
	return request.fetch(built.url, {
		method: built.method,
		headers: built.headers,
		data: built.body ?? null,
	});
}

// Reads a response against the route it answered: a reply the route declares, or a named failure.
export async function read<R extends Route>(
	route: R,
	response: APIResponse,
): Promise<Result<Reply<R>, ApiFailure>> {
	return parseReply(route, {
		status: response.status(),
		headers: response.headers(),
		text: await response.text(),
	});
}

// The body of a reply that is not a refusal, or undefined.
export async function bodyOf<R extends Route>(
	route: R,
	response: APIResponse,
): Promise<Reply<R>["body"] | undefined> {
	const reply = await read(route, response);
	return reply.isOk() ? reply.value.body : undefined;
}
