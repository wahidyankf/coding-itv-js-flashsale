import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		name: "unit",
		environment: "node",
		// Unit tests sit next to the source as *_tests.ts.
		include: ["src/**/*_tests.ts"],
		exclude: ["node_modules", "dist", "src/**/*_integration_tests.ts"],
		// Report only. Unit tests alone do not reach 99%; the 99% gate is on the combined run.
		coverage: {
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
			],
			reporter: ["text", "text-summary"],
		},
	},
});
