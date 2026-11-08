// The Vite config of flash-web: TanStack Start, Nitro for the Node server, React and Tailwind. Read by Vite when the app
// runs or builds. The port is fixed, because the e2e and the demo open the page on it.
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { defineConfig } from "vite";

// Order matters: tanstackStart() first, then nitro() for the Node server output, then the React plugin. Tailwind builds
// the stylesheet from the classes in the components. Nitro's runtime plugins run once when the server starts.
export default defineConfig({
	// "::" is dual-stack: it accepts IPv4 and IPv6, so localhost works whichever family the client picks.
	server: { host: "::", port: 3000 },
	plugins: [
		tanstackStart(),
		nitro({ plugins: ["./src/server-plugins/end-streams.ts"] }),
		viteReact(),
		tailwindcss(),
	],
});
