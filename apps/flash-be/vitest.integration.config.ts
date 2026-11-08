// Vitest config for the integration layer, `npm run test:integration`. It needs the dev stack.
import { defineConfig } from "vitest/config";

// Load the root .env so integration tests use the same URLs as the apps. It is optional.
try {
	process.loadEnvFile("../../.env");
} catch {
	// No .env yet: config.ts falls back to the compose.dev.yaml defaults.
}

// The integration layer's config, read by Vitest through `--config`.
export default defineConfig({
	test: {
		name: "integration",
		environment: "node",
		include: ["src/**/*_integration_tests.ts"],
		exclude: ["node_modules", "dist"],
		fileParallelism: false,
		// A fresh database per run keeps runs apart. global-setup.ts drops it at the end.
		globalSetup: ["./src/bdd/support/global-setup.ts"],
	},
});
