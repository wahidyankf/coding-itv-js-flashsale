import { defineConfig, devices } from "@playwright/test";

// Load the root .env so the backend port matches the apps. It is optional.
try {
	process.loadEnvFile("../../.env");
} catch {
	// No .env yet: fall back to the local defaults below.
}

const backendPort = Number(process.env.FLASH_BE_PORT ?? 8080);
const webPort = 3000;
const baseURL = `http://localhost:${webPort}`;

// Tests run against production builds, so they match what ships.
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
	projects: [
		{
			name: "chromium",
			use: { ...devices["Desktop Chrome"] },
		},
	],
	webServer: [
		{
			command:
				"npm --prefix ../flash-be run build && npm --prefix ../flash-be run start",
			url: `http://localhost:${backendPort}/health`,
			reuseExistingServer: !process.env.CI,
			timeout: 120_000,
		},
		{
			command:
				"npm --prefix ../flash-web run build && npm --prefix ../flash-web run start",
			// Wait for the health route, so tests start only when the app is ready.
			url: `${baseURL}/api/health`,
			reuseExistingServer: !process.env.CI,
			timeout: 240_000,
		},
	],
});
