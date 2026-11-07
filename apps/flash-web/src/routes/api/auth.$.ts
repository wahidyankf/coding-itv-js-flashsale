import { createFileRoute } from "@tanstack/react-router";
import { proxyToBackend } from "../../proxy";

// The browser's way to the login. The API address stays on the server, and so do the tokens: they travel only in cookies.
export const Route = createFileRoute("/api/auth/$")({
	server: {
		handlers: {
			GET: ({ request }) => proxyToBackend(request, process.env),
			POST: ({ request }) => proxyToBackend(request, process.env),
		},
	},
});
