// Unit tests of flash-load: the pure parts of scripts/ (the verdict, the report and the sampler's parsing), beside the
// source as *_tests.ts. They need no Docker and no k6, so `test:unit` runs them anywhere. Globals stay off.
import { defineConfig } from "vitest/config";

// The unit-test config for the runner's pure parts. It needs no Docker and no k6.
export default defineConfig({
	test: {
		name: "unit",
		environment: "node",
		include: ["scripts/**/*_tests.ts"],
	},
});
