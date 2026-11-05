import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { defineConfig } from "vite";

// Order matters: tanstackStart() first, then nitro() for the Node server output, then the React plugin.
export default defineConfig({
	server: { port: 3000 },
	plugins: [tanstackStart(), nitro(), viteReact()],
});
