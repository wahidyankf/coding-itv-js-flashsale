// Server only. The web server's proxy. It checks browser requests under /api, passes them to flash-be, and streams the answer back.
// Only the routes the browser needs get through, each with one method. A POST must come from this site, and the address of flash-be stays on the server.
// Decision: docs/explanation/decisions/006-browser-talks-to-web-server-only.md.
import { HTTP_STATUS, isUuid } from "@flash/flash-commons";
import { attempt, attemptAsync } from "@flash/typekit";
import { RETRY_AFTER_HEADER, TICKET_HEADER } from "./api";
import { BROWSER_ROUTES, routePattern } from "./api-paths";
import { buildConfig } from "./config";

// The routes the browser may reach, each with its one method, built from the table in api-paths.ts. Operator routes are
// not in the table.
const ALLOWED: Array<[method: string, path: RegExp]> = BROWSER_ROUTES.map(
	([method, template]) => [method, routePattern(template)],
);

// Headers that carry something the API needs, or something the browser needs back. `x-forwarded-for` is not copied: the
// browser could write any address there, so the proxy sets it itself (see `callerAddress`).
const SENT = ["content-type", TICKET_HEADER, "accept", "cookie"];
const FORWARDED_FOR = "x-forwarded-for";
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

// Says whether the browser may reach a route. A route not in `ALLOWED` is refused, so a new route stays closed until it
// is listed. `path` is the whole path of the address, such as `/api/v1/sales/current`.
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

// Stops a POST from another site that would use the shopper's cookies. `SameSite=Lax` is the first lock; this is the
// second. A browser sends `Origin` on every POST, or else `Sec-Fetch-Site`. A caller with neither is not a browser, and
// holds no cookie to misuse.
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

// Copies only the named headers, so no other header passes between the browser and flash-be.
function pick(source: Headers, names: readonly string[]): Headers {
	const picked = new Headers();
	for (const name of names) {
		const value = source.get(name);
		if (value !== null) picked.set(name, value);
	}
	return picked;
}

// The address of the caller as the socket saw it. The Node server under Nitro (srvx) puts it on the request as `ip`, and
// reads no `x-forwarded-for` for it, because no proxy is trusted here. A browser cannot choose it. The API limits by
// address, so this is what it gets; nginx's internal listener passes it on as sent (`nginx.prod.conf`).
function callerAddress(request: Request): string | undefined {
	if (!("ip" in request)) return undefined;
	const { ip } = request;
	return typeof ip === "string" && ip !== "" ? ip : undefined;
}

// The proxy's one entry point. Streams flash-be's answer back with only the allowed headers. A failed call becomes a
// 502 reply, so the shopper never sees a crash.
export async function proxyToBackend(
	request: Request,
	env: NodeJS.ProcessEnv,
	fetcher: typeof fetch = fetch,
): Promise<Response> {
	const url = new URL(request.url);
	const path = url.pathname;
	if (!isAllowed(request.method, path)) return refuse("not_found");
	if (request.method === "POST" && isCrossSite(request)) {
		return refuse("cross_site");
	}

	const headers = pick(request.headers, SENT);
	const address = callerAddress(request);
	if (address !== undefined) headers.set(FORWARDED_FOR, address);

	const answered = await attemptAsync(async (): Promise<Response> => {
		const upstream = await fetcher(`${buildConfig(env).backendUrl}${path}`, {
			method: request.method,
			headers,
			body: request.method === "POST" ? await request.text() : null,
			signal: request.signal,
		});
		const returned = pick(upstream.headers, RETURNED);
		// Every cookie, one header each: they cannot be joined into one value. The browser and the API use the same paths,
		// so a cookie passes unchanged.
		for (const cookie of upstream.headers.getSetCookie()) {
			returned.append("set-cookie", cookie);
		}
		return new Response(upstream.body, {
			status: upstream.status,
			headers: returned,
		});
	}, Error);
	return answered.isOk() ? answered.value : refuse("backend_unavailable");
}
