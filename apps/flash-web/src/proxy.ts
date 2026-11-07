// The web server's proxy: the browser's requests under /api are checked here, then passed on to flash-be, and the answer
// is streamed back. Only the routes the browser needs get through, each with its one method, and a POST must come from
// this site. The address of flash-be is read here, on the server, and never reaches the page.
// Decision: docs/explanation/decisions/006-browser-talks-to-web-server-only.md.
import { HTTP_STATUS, isUuid } from "@flash/flash-commons";
import { attempt, attemptAsync } from "@flash/typekit";
import { RETRY_AFTER_HEADER, TICKET_HEADER } from "./api";
import { buildConfig } from "./config";

// The routes the browser may reach, each with its one method. Anything else is not the browser's. In particular the
// operator routes (`GET /admin/sales`, `POST /admin/sales`, `PATCH` and `DELETE /admin/sales/:saleId`) are not here, and
// `/sales/current` comes first so it is not taken for a sale. A shopper's own routes end in `/me`: who they are comes from
// the login cookie, never from the address.
const ALLOWED: Array<[method: string, path: RegExp]> = [
	["POST", /^\/auth\/(?:register|login|refresh|logout)$/],
	["GET", /^\/auth\/me$/],
	["GET", /^\/sales\/current$/],
	["GET", /^\/sales\/(?<saleId>[^/]+)$/],
	["GET", /^\/sales\/(?<saleId>[^/]+)\/events$/],
	["POST", /^\/sales\/(?<saleId>[^/]+)\/queue$/],
	["GET", /^\/sales\/(?<saleId>[^/]+)\/queue\/me$/],
	["GET", /^\/sales\/(?<saleId>[^/]+)\/queue\/me\/events$/],
	["POST", /^\/sales\/(?<saleId>[^/]+)\/reservations$/],
	["POST", /^\/sales\/(?<saleId>[^/]+)\/purchases$/],
	["GET", /^\/sales\/(?<saleId>[^/]+)\/purchases\/me$/],
];

// Headers that carry something the API needs, or something the browser needs back. The API limits by address, so it
// needs the browser's address (`x-forwarded-for`) and not this server's.
const SENT = [
	"content-type",
	TICKET_HEADER,
	"accept",
	"cookie",
	"x-forwarded-for",
];
const RETURNED = ["content-type", "cache-control", RETRY_AFTER_HEADER];

// The answers this server gives on its own, in the shape of the API's errors. `not_found` is a copy of flash-be's code,
// status and sentence (`same_as_be_tests.ts` checks it); `backend_unavailable` exists only here.
const REFUSALS = {
	not_found: {
		status: HTTP_STATUS.notFound,
		message: "Nothing was found at this address.",
	},
	cross_site: {
		status: HTTP_STATUS.forbidden,
		message: "This request came from another site.",
	},
	backend_unavailable: {
		status: HTTP_STATUS.badGateway,
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
		return saleId === undefined || isUuid(saleId);
	}
	return false;
}

// The refresh cookie is set for `/auth` by flash-be, but the browser reaches that route as `/api/auth`, and would never
// send a cookie of another path. So the path moves under `/api`.
const BACKEND_AUTH_PATH = /;\s*Path=\/auth(?=;|$)/i;
const rewritePath = (cookie: string) =>
	cookie.replace(BACKEND_AUTH_PATH, "; Path=/api/auth");

// A cookie only helps an attacker's page when the browser sends it from another site. `SameSite=Lax` already stops that
// for a POST, and this is the second lock: the page that sends a POST must come from this very host. A browser sends
// `Origin` on every POST, or else `Sec-Fetch-Site`. A caller that sends neither is not a browser, and has no cookie of the
// shopper to misuse.
export function isCrossSite(request: Request): boolean {
	const origin = request.headers.get("origin");
	if (origin !== null) {
		const here =
			request.headers.get("x-forwarded-host") ??
			request.headers.get("host") ??
			new URL(request.url).host;
		return attempt(() => new URL(origin).host, TypeError).match({
			ok: (host) => host !== here,
			err: () => true,
		});
	}
	const site = request.headers.get("sec-fetch-site");
	return site !== null && site !== "same-origin" && site !== "none";
}

function refuse(code: keyof typeof REFUSALS): Response {
	const { status, message } = REFUSALS[code];
	return Response.json({ errorCode: code, errorMessage: message }, { status });
}

// A new header set with only the named headers that `source` has. A name that is missing is left out.
function pick(source: Headers, names: readonly string[]): Headers {
	const picked = new Headers();
	for (const name of names) {
		const value = source.get(name);
		if (value !== null) picked.set(name, value);
	}
	return picked;
}

// Passes a browser request under /api on to flash-be and streams the answer back.
export async function proxyToBackend(
	request: Request,
	env: NodeJS.ProcessEnv,
	fetcher: typeof fetch = fetch,
): Promise<Response> {
	const url = new URL(request.url);
	const path = url.pathname.replace(/^\/api/, "");
	if (!isAllowed(request.method, path)) return refuse("not_found");
	if (request.method === "POST" && isCrossSite(request)) {
		return refuse("cross_site");
	}

	const headers = pick(request.headers, SENT);

	const answered = await attemptAsync(async (): Promise<Response> => {
		const upstream = await fetcher(`${buildConfig(env).backendUrl}${path}`, {
			method: request.method,
			headers,
			body: request.method === "POST" ? await request.text() : null,
			signal: request.signal,
		});
		const returned = pick(upstream.headers, RETURNED);
		// Every cookie, one header each: they cannot be joined into one value.
		for (const cookie of upstream.headers.getSetCookie()) {
			returned.append("set-cookie", rewritePath(cookie));
		}
		return new Response(upstream.body, {
			status: upstream.status,
			headers: returned,
		});
	}, Error);
	return answered.isOk() ? answered.value : refuse("backend_unavailable");
}
