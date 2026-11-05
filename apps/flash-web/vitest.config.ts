import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
	plugins: [viteReact()],
	test: {
		environment: "jsdom",
		// Unit tests sit next to the source as *_tests.ts(x).
		include: ["src/**/*_tests.{ts,tsx}"],
		exclude: ["node_modules", ".output", "src/**/*_integration_tests.{ts,tsx}"],
	},
});
