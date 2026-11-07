import { defineConfig } from "vitest/config";

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
