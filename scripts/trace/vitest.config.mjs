// Vitest config for the trace script's tests. They use the repo's *_tests naming, so the default include does not find them.
import { defineConfig } from "vitest/config";

// Runs the trace script's tests from this folder, in Node.
export default defineConfig({
	test: {
		name: "trace",
		root: import.meta.dirname,
		environment: "node",
		include: ["*_tests.mjs"],
	},
});
