// Bundles k6/shop.ts and what it imports into one file, which the k6 container runs. k6 cannot read packages from
// node_modules, so the script and its imports must be in one file. The k6 runtime itself ("k6", "k6/http") stays outside
// the bundle. `npm run bundle` runs this on its own; the load runs call it before every k6 run.

import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// The bundled script. It is generated and ignored by Git.
export const BUNDLE = path.join(root, "k6", ".bundle", "shop.js");

// Writes BUNDLE from k6/shop.ts.
export async function bundleShop(): Promise<void> {
	await build({
		entryPoints: [path.join(root, "k6", "shop.ts")],
		outfile: BUNDLE,
		bundle: true,
		format: "esm",
		target: "es2020",
		platform: "neutral",
		mainFields: ["module", "main"],
		conditions: ["import", "default"],
		external: ["k6", "k6/*"],
		logLevel: "warning",
	});
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await bundleShop();
