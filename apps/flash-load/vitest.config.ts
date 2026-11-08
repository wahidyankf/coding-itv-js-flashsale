// Unit tests of flash-load: the pure parts of scripts/ (the verdict, the report, the sampler's parsing and the sign-up
// helpers) and of k6/ (the accounts the script shares with the runner), beside the source as *_tests.ts. They need no
// Docker and no k6, so `test:unit` runs them anywhere. Globals stay off.
import { defineConfig } from "vitest/config";

// The unit-test config for the pure parts of the runner and of the k6 script. It needs no Docker and no k6.
export default defineConfig({
	test: {
		name: "unit",
		environment: "node",
		include: ["scripts/**/*_tests.ts", "k6/**/*_tests.ts"],
	},
});
