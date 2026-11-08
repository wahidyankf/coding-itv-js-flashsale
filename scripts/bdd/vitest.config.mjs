// Vitest config for the BDD checker's tests. They use the repo's *_tests naming, so the default include does not find them.
import { defineConfig } from "vitest/config";

// Runs the BDD checker's tests from this folder, in Node.
export default defineConfig({
	test: {
		name: "bdd-check",
		root: import.meta.dirname,
		environment: "node",
		include: ["*_tests.mjs"],
	},
});
