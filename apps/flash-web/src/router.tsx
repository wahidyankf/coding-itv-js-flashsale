// Server and browser. TanStack Start builds the router the app renders with, from the generated route tree.
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

// Builds the router for the app. Each request gets its own, so no state is shared between requests.
export function getRouter() {
	return createRouter({ routeTree, scrollRestoration: true });
}
