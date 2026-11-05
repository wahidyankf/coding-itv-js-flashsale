import { defineConfig } from "@playwright/test";

// Load the root .env so the base URL matches the apps. It is optional.
try {
	process.loadEnvFile("../../.env");
} catch {
	// No .env yet: fall back to the local default below.
}

const port = Number(process.env.FLASH_BE_PORT ?? 8080);
const baseURL = process.env.FLASH_BE_URL ?? `http://localhost:${port}`;

// API tests start flash-be (built output) and wait for /health before running.
export default defineConfig({
	testDir: "./tests",
	fullyParallel: true,
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 2 : 0,
	reporter: "list",
	use: {
		baseURL,
		trace: "on-first-retry",
	},
	webServer: {
		command:
			"npm --prefix ../flash-be run build && npm --prefix ../flash-be run start",
		url: `${baseURL}/health`,
		reuseExistingServer: !process.env.CI,
		timeout: 120_000,
	},
});
