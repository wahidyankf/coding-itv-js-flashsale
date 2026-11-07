// Vitest for libs/flash-commons: plain unit tests beside the source, in Node. `test:unit` runs them with the coverage
// report. The library has no Gherkin.
import { defineConfig } from "vitest/config";

// The unit-test config for the library, with the 99% coverage floor it keeps.
export default defineConfig({
	test: {
		name: "unit",
		environment: "node",
		// Plain unit tests sit next to the source as *_tests.ts. The library has no Gherkin.
		include: ["src/**/*_tests.ts"],
		exclude: ["node_modules", "dist"],
		coverage: {
			provider: "v8",
			include: ["src/**/*.ts"],
			// Test code is not product code.
			exclude: ["src/**/*_tests.ts"],
			reporter: ["text", "text-summary"],
			thresholds: { lines: 99, functions: 99, branches: 99, statements: 99 },
		},
	},
});
