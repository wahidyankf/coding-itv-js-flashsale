// Playwright for flash-web: the scenarios of the web specs, run against production builds of flash-web and flash-be. The
// web server reaches flash-be through the forwarder, so a scenario can cut or change the API.
import { defineConfig, devices } from "@playwright/test";
import { defineBddConfig } from "playwright-bdd";
import { FORWARDER_URL } from "./steps/support/forwarder.js";

// Load the root .env so the backend port matches the apps. It is optional.
try {
	process.loadEnvFile("../../.env");
} catch {
	// No .env yet: fall back to the local defaults below.
}

const backendPort = Number(process.env.FLASH_BE_PORT ?? 8080);
const webPort = 3000;
const baseURL = `http://localhost:${webPort}`;

// The scenarios come from the specs. Scenarios tagged @e2e-exempt are proven by another layer.
const testDir = defineBddConfig({
	featuresRoot: "../../specs/apps/flash/web/behaviours",
	features: "../../specs/apps/flash/web/behaviours/**/*.feature",
	steps: ["./steps/**/*.steps.ts"],
	tags: "not @e2e-exempt",
});

// Tests run against production builds, so they match what ships.
export default defineConfig({
	testDir,
	fullyParallel: false,
	workers: 1,
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
			// The web server reaches flash-be through a forwarder that each scenario points where it needs.
			env: { FLASH_BE_URL: FORWARDER_URL },
			reuseExistingServer: !process.env.CI,
			timeout: 240_000,
		},
	],
});
