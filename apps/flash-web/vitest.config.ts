import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
	plugins: [viteReact()],
	test: {
		name: "unit",
		environment: "jsdom",
		// Unit tests sit next to the source as *_tests.ts(x).
		include: ["src/**/*_tests.{ts,tsx}"],
		exclude: ["node_modules", ".output", "src/**/*_integration_tests.{ts,tsx}"],
		// Report only. Unit tests alone do not reach 99%; the 99% gate is on the combined run.
		coverage: {
			provider: "v8",
			include: ["src/**/*.{ts,tsx}"],
			exclude: [
				"src/**/*_tests.{ts,tsx}",
				"src/**/*_integration_tests.{ts,tsx}",
				"src/bdd/**",
				"src/routeTree.gen.ts",
			],
			reporter: ["text", "text-summary"],
		},
	},
});
