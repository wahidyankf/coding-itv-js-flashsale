// k6 cannot read packages from node_modules, so the script and the libraries it imports (the contract and typekit) are
// bundled into one file. The k6 runtime itself ("k6", "k6/http") stays outside the bundle.

import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const BUNDLE = path.join(root, "k6", ".bundle", "shop.js");

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
