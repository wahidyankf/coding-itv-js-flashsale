// A client over fetch. The request is built and the reply is read by the pure functions next to it; this file only
// moves the bytes, and turns a network failure into a value.

import { attemptAsync, Err, type Result } from "@flash/typekit";
import { type ApiFailure, parseReply, type RawReply } from "./reply.js";
import { type BuiltRequest, buildRequest } from "./request.js";
import type { Reply, RequestInput, Route } from "./routes.js";
import { CLIENT_FAILURE_MESSAGE } from "./vocabulary.js";

export type Fetch = (
	url: string,
	init: { method: string; headers: Record<string, string>; body?: string },
) => Promise<{
	status: number;
	headers: { forEach: (visit: (value: string, name: string) => void) => void };
	text: () => Promise<string>;
}>;

export type ClientOptions = {
	baseUrl: string;
	fetch?: Fetch;
};

export type Client = {
	call: <R extends Route>(
		route: R,
		input: RequestInput<R>,
	) => Promise<Result<Reply<R>, ApiFailure>>;
};

const network: ApiFailure = {
	errorCode: "network",
	errorMessage: CLIENT_FAILURE_MESSAGE.network,
};

export function createClient(options: ClientOptions): Client {
	const send = options.fetch ?? fetch;

	async function transport(
		request: BuiltRequest,
	): Promise<Result<RawReply, ApiFailure>> {
		const init =
			request.body === undefined
				? { method: request.method, headers: request.headers }
				: {
						method: request.method,
						headers: request.headers,
						body: request.body,
					};
		return (
			await attemptAsync(async () => {
				const reply = await send(request.url, init);
				const headers: Record<string, string> = {};
				reply.headers.forEach((value, name) => {
					headers[name] = value;
				});
				return { status: reply.status, headers, text: await reply.text() };
			}, Error)
		).mapErr(() => network);
	}

	return {
		async call(route, input) {
			const sent = await transport(buildRequest(route, input, options.baseUrl));
			if (sent.isErr()) return new Err(sent.error);
			return parseReply(route, sent.value);
		},
	};
}
