// The integration world's web server takes requests on a plain Node `http` server. This turns one into the Request the
// proxy reads, the way the Node server under Nitro (srvx) hands it to a route. Test support only.
import type { IncomingMessage } from "node:http";

// The text headers of a request, by their lower-case names. A header that comes as a list, such as `set-cookie`, is left
// out: neither the proxy nor the fake flash-be reads one. The fake flash-be gets its requests' headers this way too.
export function textHeadersOf(
	request: IncomingMessage,
): Record<string, string> {
	const headers: Record<string, string> = {};
	for (const [name, value] of Object.entries(request.headers)) {
		if (typeof value === "string") headers[name] = value;
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
			headers: textHeadersOf(request),
			body,
			signal,
		}),
		{ ip: request.socket.remoteAddress },
	);
}
