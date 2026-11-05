import { createFileRoute } from "@tanstack/react-router";

// Liveness for the web app. Playwright and Docker health checks use this route.
export const Route = createFileRoute("/api/health")({
	server: {
		handlers: {
			GET: async () => Response.json({ status: "ok" }),
		},
	},
});
