import { defineConfig } from "vitest/config";

// Tests for the BDD checker. They use the repo's *_tests naming, so the default include does not find them.
export default defineConfig({
	test: {
		name: "bdd-check",
		root: import.meta.dirname,
		environment: "node",
		include: ["*_tests.mjs"],
	},
});
