import { defineConfig } from "vitest/config";

// Combined coverage: unit and integration tests run together, and their executed lines are merged.
// Thresholds are enforced here, so they apply to the full run, not to one layer alone.
export default defineConfig({
	test: {
		projects: ["./vitest.config.ts", "./vitest.integration.config.ts"],
		coverage: {
			enabled: true,
			provider: "v8",
			include: ["src/**/*.ts"],
			exclude: [
				// Test code is not product code.
				"src/**/*_tests.ts",
				"src/**/*_integration_tests.ts",
				"src/bdd/**",
				// Process entry points. The e2e suite runs main.ts; migrate.ts only wires config,
				// the migrator and the exit code, and the migrator is covered by integration tests.
				"src/main.ts",
				"src/migrate.ts",
				// seed-sale.ts only reads the command line, wires config and sets the exit code. The parser and
				// the insert it calls are covered by unit and integration tests, and the e2e suite runs the command.
				"src/seed-sale.ts",
				// openapi.ts only writes the document that the tested builder makes to a file.
				"src/openapi.ts",
			],
			reporter: ["text", "text-summary"],
			thresholds: { lines: 99, functions: 99, branches: 99, statements: 99 },
		},
	},
});
