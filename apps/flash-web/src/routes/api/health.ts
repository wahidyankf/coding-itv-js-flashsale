import { createFileRoute } from "@tanstack/react-router";

// Liveness for the web app. Playwright and Docker health checks use this route.
export function healthResponse(): Response {
	return Response.json({ status: "ok" });
}

export const Route = createFileRoute("/api/health")({
	server: {
		handlers: {
			GET: () => healthResponse(),
		},
	},
});
