// Server only. The web server's catch-all for /api. A route under /api that no other route takes, such as an old path
// without the version or an operator route, goes to the proxy, which refuses it with the API's `not_found`. The probe at
// /api/health and the versioned routes are more specific, so they are matched first.
import { createFileRoute } from "@tanstack/react-router";
import { proxyToBackend } from "../../proxy";

// Every method goes to the proxy, so each refusal has the same body. The route id is the file's path, a literal.
export const Route = createFileRoute("/api/$")({
	server: {
		handlers: {
			GET: ({ request }) => proxyToBackend(request, process.env),
			POST: ({ request }) => proxyToBackend(request, process.env),
			PATCH: ({ request }) => proxyToBackend(request, process.env),
			DELETE: ({ request }) => proxyToBackend(request, process.env),
		},
	},
});
