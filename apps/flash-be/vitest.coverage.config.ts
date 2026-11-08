// Vitest config for the combined run, `npm run test:coverage`: unit and integration tests with the 99% gate.
import { defineConfig } from "vitest/config";

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
				// create-operator.ts is the same kind of entry point: it reads the command line, hashes the password and
				// calls the account store, which the integration tests cover. The e2e suite runs the command.
				"src/create-operator.ts",
			],
			reporter: ["text", "text-summary"],
			thresholds: { lines: 99, functions: 99, branches: 99, statements: 99 },
		},
	},
});
