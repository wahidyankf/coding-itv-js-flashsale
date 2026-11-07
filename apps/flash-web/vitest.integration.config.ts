// Integration tests of flash-web: *_integration_tests.ts(x) in Node, against a fake flash-be served over real HTTP. They
// are not part of test:quick; the combined coverage run includes them.
import { defineConfig } from "vitest/config";

// Load the root .env so tests see the same FLASH_BE_URL as the app. It is optional.
try {
	process.loadEnvFile("../../.env");
} catch {
	// No .env yet: the config falls back to the local default.
}

export default defineConfig({
	test: {
		name: "integration",
		environment: "node",
		include: ["src/**/*_integration_tests.{ts,tsx}"],
		exclude: ["node_modules", ".output"],
	},
});
