import { defineConfig } from "@playwright/test";
import { defineBddConfig } from "playwright-bdd";

// The checker's own scenarios. None is exempt from e2e, so every one runs here.
const testDir = defineBddConfig({
	featuresRoot: "../../../specs/tooling/bdd-check/behaviours",
	features: "../../../specs/tooling/bdd-check/behaviours/**/*.feature",
	steps: ["./steps/**/*.steps.ts"],
});

export default defineConfig({
	testDir,
	fullyParallel: false,
	workers: 1,
	reporter: "list",
});
