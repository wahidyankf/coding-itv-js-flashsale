// Server only. The web server's route for the account API. Every method goes to the proxy, which decides what passes.
import { createFileRoute } from "@tanstack/react-router";
import { proxyToBackend } from "../../../proxy";

// The browser's way to the login. The API address stays on the server, and so do the tokens: they travel only in cookies.
// The route id is the file's path, so it is a literal: the router reads it from this file.
export const Route = createFileRoute("/api/v1/auth/$")({
	server: {
		handlers: {
			GET: ({ request }) => proxyToBackend(request, process.env),
			POST: ({ request }) => proxyToBackend(request, process.env),
		},
	},
});
