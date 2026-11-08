// The integration world's web server takes requests on a plain Node `http` server. This turns one into the Request the
// proxy reads, the way the Node server under Nitro (srvx) hands it to a route. Test support only.
import type { IncomingMessage } from "node:http";

// The request headers, as the proxy takes them. Only text headers are kept.
function headersOf(request: IncomingMessage): Headers {
	const headers = new Headers();
	for (const [name, value] of Object.entries(request.headers)) {
		if (typeof value === "string") headers.set(name, value);
	}
	return headers;
}

// The browser's request as a route gets it. Like srvx, it carries the socket's address as `ip`, which is the address the
// proxy tells the API.
export function requestOf(
	request: IncomingMessage,
	body: string | null,
	signal: AbortSignal,
): Request {
	return Object.assign(
		new Request(new URL(request.url ?? "/", "http://web.test"), {
			method: request.method ?? "GET",
			headers: headersOf(request),
			body,
			signal,
		}),
		{ ip: request.socket.remoteAddress },
	);
}
