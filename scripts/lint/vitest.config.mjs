// Vitest config for the lint rule tests. They use the repo's *_tests naming, so the default include does not find them.
import { defineConfig } from "vitest/config";

// Runs the lint rule tests from this folder, in Node.
export default defineConfig({
	test: {
		name: "lint-rules",
		root: import.meta.dirname,
		environment: "node",
		include: ["*_tests.mjs"],
	},
});
