import { attempt, attemptAsync } from "@flash/typekit";
import { RETRY_AFTER_HEADER, STATUS, TICKET_HEADER } from "./api";
import { buildConfig } from "./config";

// The routes the browser may reach, each with its one method. Anything else is not the browser's. In particular the
// operator route (`POST /admin/sales`) is not here, and `/sales/current` comes first so it is not taken for a sale.
const ALLOWED: Array<[method: string, path: RegExp]> = [
	["GET", /^\/sales\/current$/],
	["GET", /^\/sales\/(?<saleId>[^/]+)$/],
	["GET", /^\/sales\/(?<saleId>[^/]+)\/events$/],
	["POST", /^\/sales\/(?<saleId>[^/]+)\/queue$/],
	["GET", /^\/sales\/(?<saleId>[^/]+)\/queue\/(?<userId>[^/]+)$/],
	["GET", /^\/sales\/(?<saleId>[^/]+)\/queue\/(?<userId>[^/]+)\/events$/],
	["POST", /^\/sales\/(?<saleId>[^/]+)\/reservations$/],
	["POST", /^\/sales\/(?<saleId>[^/]+)\/purchases$/],
	["GET", /^\/sales\/(?<saleId>[^/]+)\/purchases\/(?<userId>[^/]+)$/],
];

// A copy of the sale id rule of flash-be (`isSaleId`); `same_as_be_tests.ts` checks it.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// A name in a path may still be percent-encoded and in any case; the API normalises it.
const USER_IN_PATH = /^[A-Za-z0-9._@+-]{1,200}$/;

// Headers that carry something the API needs, or something the browser needs back.
const SENT = ["content-type", TICKET_HEADER, "accept"];
const RETURNED = ["content-type", "cache-control", RETRY_AFTER_HEADER];

// The answers this server gives on its own, in the shape of the API's errors. `not_found` is a copy of flash-be's code,
// status and sentence (`same_as_be_tests.ts` checks it); `backend_unavailable` exists only here.
const REFUSALS = {
	not_found: {
		status: STATUS.notFound,
		message: "Nothing was found at this address.",
	},
	backend_unavailable: {
		status: STATUS.badGateway,
		message: "The API could not be reached.",
	},
};

// A value that cannot be decoded becomes "", which no pattern below accepts.
const decode = (value: string | undefined) =>
	value === undefined
		? undefined
		: attempt(() => decodeURIComponent(value), URIError).match({
				ok: (decoded) => decoded,
				err: () => "",
			});

// `path` is what follows `/api`, such as `/sales/current`.
export function isAllowed(method: string, path: string): boolean {
	for (const [allowed, pattern] of ALLOWED) {
		if (allowed !== method) continue;
		const found = pattern.exec(path);
		if (!found) continue;
		const saleId = decode(found.groups?.saleId);
		const userId = decode(found.groups?.userId);
		return (
			(saleId === undefined || UUID.test(saleId)) &&
			(userId === undefined || USER_IN_PATH.test(userId))
		);
	}
	return false;
}

function refuse(code: keyof typeof REFUSALS): Response {
	const { status, message } = REFUSALS[code];
	return Response.json({ errorCode: code, errorMessage: message }, { status });
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
