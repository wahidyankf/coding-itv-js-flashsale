import {
	ERROR_STATUS,
	type ErrorCode,
	errorPayload,
	isUuid,
	matchRoute,
	RETRY_AFTER_HEADER,
	routes,
	TICKET_HEADER,
} from "@flash/contract";
import { attemptAsync } from "@flash/typekit";
import { buildConfig } from "./config";

// The routes the browser may reach are the ones the contract marks `passThrough`, each with its one method. Anything
// else is not the browser's.
const PASS_THROUGH = Object.values(routes).filter((route) => route.passThrough);

// A name in a path may still be percent-encoded and in any case; the API normalises it.
const USER_IN_PATH = /^[A-Za-z0-9._@+-]{1,200}$/;

// Headers that carry something the API needs, or something the browser needs back.
const SENT = ["content-type", TICKET_HEADER, "accept"];
const RETURNED = ["content-type", "cache-control", RETRY_AFTER_HEADER];

// `path` is what follows `/api`, such as `/sales/current`.
export function isAllowed(method: string, path: string): boolean {
	const match = matchRoute(method, path, PASS_THROUGH);
	if (!match) return false;
	const { saleId, userId } = match.params;
	return (
		(saleId === undefined ||
			isUuid(saleId) ||
			match.route.name === "currentSale") &&
		(userId === undefined || USER_IN_PATH.test(userId))
	);
}

function refuse(code: ErrorCode): Response {
	return Response.json(errorPayload(code), { status: ERROR_STATUS[code] });
}

// Passes a browser request under /api/sales on to flash-be and streams the answer back. The address of flash-be is read
// here, on the server, and never reaches the page.
export async function proxyToBackend(
	request: Request,
	env: NodeJS.ProcessEnv,
	fetcher: typeof fetch = fetch,
): Promise<Response> {
	const url = new URL(request.url);
	const path = url.pathname.replace(/^\/api/, "");
	if (!isAllowed(request.method, path)) return refuse("not_found");

	const headers = new Headers();
	for (const name of SENT) {
		const value = request.headers.get(name);
		if (value !== null) headers.set(name, value);
	}
	// The API limits by address, so it needs the browser's address and not this server's.
	const forwarded = request.headers.get("x-forwarded-for");
	if (forwarded !== null) headers.set("x-forwarded-for", forwarded);

	const answered = await attemptAsync(async (): Promise<Response> => {
		const upstream = await fetcher(`${buildConfig(env).backendUrl}${path}`, {
			method: request.method,
			headers,
			body: request.method === "POST" ? await request.text() : null,
			signal: request.signal,
		});
		const returned = new Headers();
		for (const name of RETURNED) {
			const value = upstream.headers.get(name);
			if (value !== null) returned.set(name, value);
		}
		return new Response(upstream.body, {
			status: upstream.status,
			headers: returned,
		});
	}, Error);
	return answered.isOk() ? answered.value : refuse("backend_unavailable");
}
