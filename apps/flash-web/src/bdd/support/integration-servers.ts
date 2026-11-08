// The two loopback servers of the integration world: the fake flash-be spoken over HTTP, with its event streams, and the
// web server that runs the real proxy against it. Test support only.
import {
	createServer,
	type IncomingMessage,
	type Server,
	type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";
import { JSON_CONTENT_TYPE, TICKET_HEADER } from "../../api";
import { proxyToBackend } from "../../proxy";
import type { FakeBackend } from "./fake-backend";
import { errorPayload, type Match, matchRoute } from "./fake-http";
import { requestOf, textHeadersOf } from "./node-request";

// Starts a server on a free loopback port, so parallel scenarios never share an address. Resolves to the address it got.
export function listen(server: Server): Promise<string> {
	return new Promise((resolve) =>
		server.listen(0, "127.0.0.1", () => {
			const { port } = server.address() as AddressInfo;
			resolve(`http://127.0.0.1:${port}`);
		}),
	);
}

// Closes a server and every connection it holds, so a finished suite leaves no socket open.
export function stop(server: Server): Promise<void> {
	server.closeAllConnections();
	return new Promise((resolve) => server.close(() => resolve()));
}

async function readBody(request: IncomingMessage): Promise<string> {
	const chunks: Buffer[] = [];
	for await (const chunk of request) chunks.push(chunk as Buffer);
	return Buffer.concat(chunks).toString("utf8");
}

// Writes one event of a stream, unless the same frame was just written.
function pushFrames(
	backend: FakeBackend,
	match: Match,
	user: string,
	response: ServerResponse,
): () => void {
	const isPlace = match.name === "placeEvents";
	let last = "";
	return () => {
		if (!backend.hasSale()) return;
		const [event, data] = isPlace
			? ["place", { userId: user, ...backend.placeOf(user) }]
			: ["sale", backend.view()];
		const frame = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
		if (frame === last) return;
		last = frame;
		response.write(frame);
	};
}

// Opens an event stream on the fake flash-be. A place stream is a shopper's own: the cookie says who, and the ticket
// proves the place.
function stream(
	backend: FakeBackend,
	match: Match,
	ticket: string | undefined,
	request: IncomingMessage,
	response: ServerResponse,
): void {
	const isPlace = match.name === "placeEvents";
	const user = backend.userOf(request.headers.cookie) ?? "";
	if (backend.isCutOff()) throw new Error("unreachable");
	if (isPlace && (user === "" || ticket !== `ticket-${user}`)) {
		// The body names the code, as flash-be's does, so the renewing fetch can tell a lost login from a wrong ticket.
		const code = user === "" ? "not_authenticated" : "invalid_ticket";
		response
			.writeHead(401, { "content-type": JSON_CONTENT_TYPE })
			.end(JSON.stringify(errorPayload(code)));
		return;
	}
	response.writeHead(200, { "content-type": "text/event-stream" });
	const push = pushFrames(backend, match, user, response);
	push();
	const off = backend.onChange(push);
	request.on("close", off);
}

// The fake flash-be, spoken over HTTP, including the two event streams.
export function backendServer(current: () => FakeBackend): Server {
	return createServer(async (request, response) => {
		const backend = current();
		const path = request.url ?? "";
		const header = request.headers[TICKET_HEADER];
		const ticket = typeof header === "string" ? header : undefined;
		try {
			const match = matchRoute(request.method ?? "GET", path);
			if (match?.name === "saleEvents" || match?.name === "placeEvents") {
				return stream(backend, match, ticket, request, response);
			}
			const text = await readBody(request);
			const reply = backend.handle(
				request.method ?? "GET",
				path,
				textHeadersOf(request),
				text ? JSON.parse(text) : {},
			);
			response.writeHead(reply.status, {
				"content-type": JSON_CONTENT_TYPE,
				...reply.headers,
				...(reply.cookies?.length ? { "set-cookie": reply.cookies } : {}),
			});
			response.end(JSON.stringify(reply.body));
		} catch {
			// An unreachable backend: the connection just breaks.
			request.socket.destroy();
		}
	});
}

// Hands one browser request to the proxy, and writes the answer back, cookies included.
async function relay(
	request: IncomingMessage,
	response: ServerResponse,
	backendUrl: () => string,
): Promise<void> {
	const controller = new AbortController();
	response.on("close", () => controller.abort());
	const body = request.method === "POST" ? await readBody(request) : null;
	const reply = await proxyToBackend(
		requestOf(request, body, controller.signal),
		{ FLASH_BE_URL: backendUrl() },
	);
	response.writeHead(reply.status, {
		...Object.fromEntries(reply.headers),
		// Several cookies are several headers, which a plain object cannot hold.
		"set-cookie": reply.headers.getSetCookie(),
	});
	try {
		if (reply.body) {
			for await (const chunk of reply.body) response.write(chunk);
		}
	} catch {
		// The client went away while the stream was open.
	}
	response.end();
}

// The web server: the proxy, on a real port.
export function webServer(backendUrl: () => string): Server {
	return createServer((request, response) => {
		void relay(request, response, backendUrl);
	});
}
