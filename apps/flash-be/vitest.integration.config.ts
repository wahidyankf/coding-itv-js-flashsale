import { defineConfig } from "vitest/config";

// Load the root .env so integration tests use the same URLs as the apps. It is optional.
try {
	process.loadEnvFile("../../.env");
} catch {
	// No .env yet: config.ts falls back to the compose.dev.yaml defaults.
}

export default defineConfig({
	test: {
		environment: "node",
		include: ["src/**/*_integration_tests.ts"],
		exclude: ["node_modules", "dist"],
		fileParallelism: false,
	},
});
