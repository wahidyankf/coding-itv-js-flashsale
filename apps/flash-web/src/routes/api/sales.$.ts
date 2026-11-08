// Server only. The web server's route for the sale API. Every method goes to the proxy, which decides what passes.
import { createFileRoute } from "@tanstack/react-router";
import { proxyToBackend } from "../../proxy";

// The browser's way to the sale. The API address stays on the server.
export const Route = createFileRoute("/api/sales/$")({
	server: {
		handlers: {
			GET: ({ request }) => proxyToBackend(request, process.env),
			POST: ({ request }) => proxyToBackend(request, process.env),
		},
	},
});
