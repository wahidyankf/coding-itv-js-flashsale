// The web server's health route. Playwright and Docker check it, so it answers without asking flash-be.
import { createFileRoute } from "@tanstack/react-router";

// Liveness for the web app. Playwright and Docker health checks use this route.
export function healthResponse(): Response {
	return Response.json({ status: "ok" });
}

// Registers the health route on the web server.
export const Route = createFileRoute("/api/health")({
	server: {
		handlers: {
			GET: () => healthResponse(),
		},
	},
});
