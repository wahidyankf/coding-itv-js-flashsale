import { defineConfig } from "vitest/config";

// Tests for the guard that keeps the API contract in one place. They use the repo's *_tests naming.
export default defineConfig({
	test: {
		name: "contract-guard",
		root: import.meta.dirname,
		environment: "node",
		include: ["*_tests.mjs"],
	},
});
