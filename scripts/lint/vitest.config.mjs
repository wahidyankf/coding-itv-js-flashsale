import { defineConfig } from "vitest/config";

// Tests for the lint rules. They use the repo's *_tests naming, so the default include does not find them.
export default defineConfig({
	test: {
		name: "lint-rules",
		root: import.meta.dirname,
		environment: "node",
		include: ["*_tests.mjs"],
	},
});
