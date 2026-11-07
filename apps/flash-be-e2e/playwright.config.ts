// Playwright for flash-be: the scenarios of the API specs, run against a built flash-be on its own port.
import { defineConfig } from "@playwright/test";
import { defineBddConfig } from "playwright-bdd";

// Load the root .env so the base URL matches the apps. It is optional.
try {
	process.loadEnvFile("../../.env");
} catch {
	// No .env yet: fall back to the local default below.
}

const port = Number(process.env.FLASH_BE_PORT ?? 8080);
const baseURL = process.env.FLASH_BE_URL ?? `http://localhost:${port}`;

// The scenarios come from the specs. Scenarios tagged @e2e-exempt are proven by another layer.
const testDir = defineBddConfig({
	featuresRoot: "../../specs/apps/flash/be/behaviours",
	features: "../../specs/apps/flash/be/behaviours/**/*.feature",
	steps: ["./steps/**/*.steps.ts"],
	tags: "not @e2e-exempt",
});

// API tests start flash-be (built output) and wait for /health before running.
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
	webServer: {
		command:
			"npm --prefix ../flash-be run build && npm --prefix ../flash-be run start",
		url: `${baseURL}/health`,
		reuseExistingServer: !process.env.CI,
		timeout: 120_000,
	},
});
