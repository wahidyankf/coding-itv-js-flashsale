import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		environment: "node",
		// Unit tests sit next to the source as *_tests.ts.
		include: ["src/**/*_tests.ts"],
		exclude: ["node_modules", "dist", "src/**/*_integration_tests.ts"],
	},
});
