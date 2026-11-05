import { buildConfig } from "./config";

const ID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const USER = "[A-Za-z0-9._@+%-]{1,200}";

// The only paths the browser may reach, each with the one method it may use. Anything else is not the browser's.
const ROUTES: Array<{ method: "GET" | "POST"; path: RegExp }> = [
	{ method: "GET", path: /^current$/ },
	{ method: "GET", path: new RegExp(`^${ID}$`) },
	{ method: "GET", path: new RegExp(`^${ID}/events$`) },
	{ method: "POST", path: new RegExp(`^${ID}/queue$`) },
	{ method: "GET", path: new RegExp(`^${ID}/queue/${USER}$`) },
	{ method: "GET", path: new RegExp(`^${ID}/queue/${USER}/events$`) },
	{ method: "POST", path: new RegExp(`^${ID}/reservations$`) },
	{ method: "POST", path: new RegExp(`^${ID}/purchases$`) },
	{ method: "GET", path: new RegExp(`^${ID}/purchases/${USER}$`) },
];

// Headers that carry something the API needs, or something the browser needs back.
const SENT = ["content-type", "x-queue-ticket", "accept"];
const RETURNED = ["content-type", "cache-control", "retry-after"];

export function isAllowed(method: string, path: string): boolean {
	return ROUTES.some(
		(route) => route.method === method && route.path.test(path),
	);
}

function json(status: number, body: unknown): Response {
	return Response.json(body, { status });
}

// Passes a browser request under /api/sales on to flash-be and streams the answer back. The address of flash-be is read
// here, on the server, and never reaches the page.
export async function proxyToBackend(
	request: Request,
	env: NodeJS.ProcessEnv,
	fetcher: typeof fetch = fetch,
): Promise<Response> {
	const url = new URL(request.url);
	const path = url.pathname.replace(/^\/api\/sales\//, "");
	if (!isAllowed(request.method, path)) {
		return json(404, { error: "not_found" });
	}

	const headers = new Headers();
	for (const name of SENT) {
		const value = request.headers.get(name);
		if (value !== null) headers.set(name, value);
	}
	// The API limits by address, so it needs the browser's address and not this server's.
	const forwarded = request.headers.get("x-forwarded-for");
	if (forwarded !== null) headers.set("x-forwarded-for", forwarded);

	try {
		const upstream = await fetcher(
			`${buildConfig(env).backendUrl}/sales/${path}`,
			{
				method: request.method,
				headers,
				body: request.method === "POST" ? await request.text() : null,
				signal: request.signal,
			},
		);
		const returned = new Headers();
		for (const name of RETURNED) {
			const value = upstream.headers.get(name);
			if (value !== null) returned.set(name, value);
		}
		return new Response(upstream.body, {
			status: upstream.status,
			headers: returned,
		});
	} catch {
		return json(502, { error: "backend_unavailable" });
	}
}
