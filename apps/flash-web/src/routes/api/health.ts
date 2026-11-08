// Server only. The web server's health route. Playwright and Docker check it, so it answers without asking flash-be.
import { createFileRoute } from "@tanstack/react-router";

// Liveness for the web app. Playwright and Docker health checks use this route.
function healthResponse(): Response {
	return Response.json({ status: "ok" });
}

// Answers without calling flash-be, so the probe still works when flash-be is down.
export const Route = createFileRoute("/api/health")({
	server: {
		handlers: {
			GET: () => healthResponse(),
		},
	},
});
