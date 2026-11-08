// Guards the rule that the page clients, the sale loader and the proxy write no API path of their own: each takes its
// paths from the table in @flash/flash-commons. The probes `/api/health` and `/health` are the only exceptions. The
// check reads the source text, and skips comments. Decision: docs/explanation/decisions/019-api-version-prefix.md.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// The files that build the browser's and the server's API calls.
const SCANNED = [
	"sale/client.ts",
	"auth/client.ts",
	"web-api.ts",
	"sale/load.ts",
	"proxy.ts",
];
// Text that starts or names an API route: the prefix, or a route word after the prefix.
const ROUTE_TEXT =
	/\/api\/|\/sales|\/auth|\/admin|\/queue|\/purchases|\/reservations|\/events/;
// The probes are not API routes, so the rule does not count them.
const PROBES = /\/api\/health|\/health/g;

// The text of every string and template in a file. Full-line and trailing comments are left out, so a comment may
// describe a route; a `//` inside a string, such as in `http://`, is kept.
function literalsOf(source: string): string[] {
	const code = source
		.split("\n")
		.filter((line) => !/^\s*(\/\/|\/\*|\*)/.test(line))
		.map((line) => line.replace(/(^|\s)\/\/.*$/, ""))
		.join("\n");
	return [...code.matchAll(/"([^"\n]*)"|'([^'\n]*)'|`([^`]*)`/g)].map(
		(match) => match[1] ?? match[2] ?? match[3] ?? "",
	);
}

// A module path (`./auth/client`, `@flash/...`) names a file, not an API route, so it is not counted.
const MODULE_PATH = /^(\.{1,2}\/|@)/;

// The literals that write an API route, once the probes and the module paths are taken out.
function routeLiteralsOf(source: string): string[] {
	return literalsOf(source).filter(
		(text) =>
			!MODULE_PATH.test(text) && ROUTE_TEXT.test(text.replace(PROBES, "")),
	);
}

describe("the scanner", () => {
	it("finds a route written in a string, a template or a line that a comment shares", () => {
		const planted = [
			'const a = "/api/v1/sales/x";',
			`const b = \`\${base}/sales/\${id}\`;`,
			"const c = 1; // the /api/auth text is only a comment",
		].join("\n");
		expect(routeLiteralsOf(planted)).toEqual([
			"/api/v1/sales/x",
			`\${base}/sales/\${id}`,
		]);
	});

	it("does not count a module path, which names a file", () => {
		expect(
			routeLiteralsOf('import { x } from "./auth/client";\nimport "@a/sales";'),
		).toEqual([]);
	});

	it("keeps the probes and an address with two slashes", () => {
		expect(
			routeLiteralsOf('const p = "/health"; const q = "http://flash-be.test";'),
		).toEqual([]);
	});
});

describe("the page clients, the sale loader and the proxy", () => {
	it.each(SCANNED)("%s writes no API path of its own", (file) => {
		const source = readFileSync(new URL(file, import.meta.url), "utf8");
		expect(routeLiteralsOf(source)).toEqual([]);
	});

	it.each(SCANNED)("%s takes its paths from the table", (file) => {
		const source = readFileSync(new URL(file, import.meta.url), "utf8");
		expect(source).toMatch(/API_PATHS|BROWSER_ROUTES|API_PREFIX|PROBE_PATHS/);
	});
});
