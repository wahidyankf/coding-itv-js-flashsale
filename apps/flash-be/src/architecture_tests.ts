// Architecture tests (test layer). They read the source and fail on a wrong import, so the layers of the hexagon hold.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// The hexagon the tests check: the domain knows nothing, the application knows the domain, and adapters know both but
// never each other. Only the entry points (main, composition, migrate, seed-sale) wire adapters to ports.
const SRC = import.meta.dirname;

type Layer =
	| "domain"
	| "application"
	| "inbound"
	| "outbound"
	| "root"
	| "test";

function walk(dir: string): string[] {
	return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const full = path.join(dir, entry.name);
		return entry.isDirectory() ? walk(full) : [full];
	});
}

function layerOf(file: string): Layer {
	const rel = path.relative(SRC, file).split(path.sep).join("/");
	if (/_tests\.ts$|_integration_tests\.ts$|^bdd\//.test(rel)) return "test";
	if (rel.startsWith("domain/")) return "domain";
	if (rel.startsWith("application/")) return "application";
	if (rel.startsWith("adapters/inbound/")) return "inbound";
	if (rel.startsWith("adapters/outbound/")) return "outbound";
	return "root";
}

// `typeOnly` is an `import type`, which is erased and loads nothing at run time.
type Import = { from: string; target: string; typeOnly: boolean };

// The three ways a module is named in source: `import ... from "x"` and `export ... from "x"`, the bare `import "x"`, and
// the dynamic `import("x")`. Each one names a module, so each one is checked.
const FROM_CLAUSE = /\b(?:import|export)(\s+type)?\b[^;"]*?\bfrom\s+"([^"]+)"/g;
const BARE_IMPORT = /\bimport\s+"([^"]+)"/g;
const DYNAMIC_IMPORT = /\bimport\(\s*"([^"]+)"\s*\)/g;

// Every import, re-export, bare import and dynamic import in `text`, as written. A relative target is resolved to a path
// under src, so the layer of the target can be told. Exported so the scan can be tested on sample source.
export function importsIn(file: string, text: string): Import[] {
	const clauses = [...text.matchAll(FROM_CLAUSE)].flatMap((match) =>
		match[2] === undefined
			? []
			: [{ spec: match[2], typeOnly: match[1] !== undefined }],
	);
	const bare = [...text.matchAll(BARE_IMPORT)].flatMap((match) =>
		match[1] === undefined ? [] : [{ spec: match[1], typeOnly: false }],
	);
	const dynamic = [...text.matchAll(DYNAMIC_IMPORT)].flatMap((match) =>
		match[1] === undefined ? [] : [{ spec: match[1], typeOnly: false }],
	);
	return [...clauses, ...bare, ...dynamic].map(({ spec, typeOnly }) => {
		if (!spec.startsWith(".")) return { from: file, target: spec, typeOnly };
		const resolved = path.resolve(
			path.dirname(file),
			spec.replace(/\.js$/, ".ts"),
		);
		return { from: file, target: path.relative(SRC, resolved), typeOnly };
	});
}

function importsOf(file: string): Import[] {
	return importsIn(file, readFileSync(file, "utf8"));
}

const files = walk(SRC).filter((file) => file.endsWith(".ts"));
const product = files.filter((file) => layerOf(file) !== "test");

// A declaration of a value that @flash/flash-commons owns: a millisecond unit or an HTTP status number.
const COPIED_SHARED_VALUE =
	/\bconst\s+(MS_PER_\w+|MINUTE_MS|HOUR_MS|HTTP_STATUS|FIRST_CLIENT_ERROR_STATUS|FIRST_SERVER_ERROR_STATUS)\b/;

// The Node built-ins the domain may use: the hash and the signature of a ticket and a token, and nothing else. The
// application takes none: the wiring passes in every id, clock and random draw, so no service reads them itself.
const DOMAIN_NODE_MODULES = ["node:crypto"];
// The shared libraries have no I/O of their own, so the inner layers may use them: typekit for types and `Result`, and
// flash-commons for pure behaviour and values (retry, the time units, the HTTP status numbers). Exact names only, so a
// look-alike package such as `@flash/flash-commons-extras` is still refused.
const KERNEL_PACKAGES = ["@flash/typekit", "@flash/flash-commons"];
// The timer helper is the one part of flash-commons that starts a timer, so it is not in the kernel. Neither the domain
// nor the application may take it: a service that needs a wait gets one passed in by the wiring. The adapters may.
const isKernel = (target: string) => KERNEL_PACKAGES.includes(target);
const isDomain = (target: string) => target.startsWith("domain/");
const isNodeModule = (target: string, allowedNames: string[]) =>
	allowedNames.includes(target);
const isPort = (target: string) => target.startsWith("application/ports/");
const isWiring = (target: string) =>
	target.startsWith("composition") || target.startsWith("config");

// What a layer may import. A package name or a path outside the list is a violation.
function allowed(layer: Layer, target: string): boolean {
	switch (layer) {
		case "domain":
			return (
				isNodeModule(target, DOMAIN_NODE_MODULES) ||
				isKernel(target) ||
				isDomain(target)
			);
		case "application":
			return (
				isKernel(target) ||
				isDomain(target) ||
				target.startsWith("application/")
			);
		case "inbound":
			return !target.startsWith("adapters/outbound/") && !isWiring(target);
		case "outbound":
			return (
				!target.startsWith("adapters/inbound/") &&
				!(target.startsWith("application/") && !isPort(target)) &&
				!isWiring(target)
			);
		default:
			return true;
	}
}

function violations(layer: Layer): string[] {
	return product
		.filter((file) => layerOf(file) === layer)
		.flatMap(importsOf)
		.filter((imp) => !allowed(layer, imp.target))
		.map((imp) => `${path.relative(SRC, imp.from)} -> ${imp.target}`);
}

describe("hexagonal architecture", () => {
	it("sees the layers it checks", () => {
		for (const layer of [
			"domain",
			"application",
			"inbound",
			"outbound",
		] as const) {
			expect(
				product.filter((file) => layerOf(file) === layer).length,
			).toBeGreaterThan(0);
		}
	});

	it("keeps the domain free of the application, adapters and packages", () => {
		expect(violations("domain")).toEqual([]);
	});

	it("keeps the application free of adapters and packages", () => {
		expect(violations("application")).toEqual([]);
	});

	it("keeps inbound adapters away from outbound adapters and the wiring", () => {
		expect(violations("inbound")).toEqual([]);
	});

	it("lets outbound adapters implement ports, not use services or inbound adapters", () => {
		expect(violations("outbound")).toEqual([]);
	});

	// The time units and the standard HTTP status numbers have one definition, in @flash/flash-commons. A local copy
	// would drift from it, so none may be declared here. The contract words (ERROR_STATUS, TICKET_HEADER) are not copies.
	it("takes the time units and the HTTP status numbers from @flash/flash-commons, with no copy of its own", () => {
		const copies = files
			.filter((file) => !file.endsWith("architecture_tests.ts"))
			.filter((file) => COPIED_SHARED_VALUE.test(readFileSync(file, "utf8")))
			.map((file) => path.relative(SRC, file));
		expect(copies).toEqual([]);
	});

	// The wait of a timer is written once, in @flash/flash-commons/timers. A local wrapper such as
	// `setTimeout(resolve, ms)` would be a second copy. A literal wait in a test (`setTimeout(resolve, 50)`) is allowed.
	it("waits with sleep from @flash/flash-commons/timers, with no setTimeout wrapper of its own", () => {
		const wrappers = files
			.filter((file) => !file.endsWith("architecture_tests.ts"))
			.filter((file) =>
				/setTimeout\(resolve,\s*[a-zA-Z]/.test(readFileSync(file, "utf8")),
			)
			.map((file) => path.relative(SRC, file));
		expect(wrappers).toEqual([]);
	});

	// The mock pays through its ledger contract (decision 009); which store keeps the ledger is the wiring's choice.
	it("keeps the mock payment free of the database: adapters/outbound/payment imports no kysely, pg or Postgres adapter", () => {
		const payment = product.filter((file) =>
			path.relative(SRC, file).startsWith("adapters/outbound/payment/"),
		);
		expect(payment.length).toBeGreaterThan(0);
		const reaching = payment
			.flatMap(importsOf)
			.filter(
				(imp) =>
					imp.target === "kysely" ||
					imp.target === "pg" ||
					imp.target.startsWith("adapters/outbound/postgres/"),
			)
			.map((imp) => `${path.relative(SRC, imp.from)} -> ${imp.target}`);
		expect(reaching).toEqual([]);
	});

	it("never erases a row: the product code has no `deleteFrom(`", () => {
		const erasing = product
			.filter((file) => /\bdeleteFrom\(/.test(readFileSync(file, "utf8")))
			.map((file) => path.relative(SRC, file));
		expect(erasing).toEqual([]);
	});

	it("rejects the imports the rules forbid", () => {
		expect(allowed("domain", "application/sale-service.ts")).toBe(false);
		expect(allowed("domain", "kysely")).toBe(false);
		expect(
			allowed("application", "adapters/outbound/redis/redis-client.ts"),
		).toBe(false);
		expect(allowed("application", "fastify")).toBe(false);
		expect(allowed("domain", "@flash/typekit-extras")).toBe(false);
		expect(allowed("domain", "@flash/flash-commons-extras")).toBe(false);
		expect(allowed("application", "@flash/flash-commons-extras")).toBe(false);
		expect(allowed("domain", "zod")).toBe(false);
		expect(allowed("application", "zod")).toBe(false);
		expect(allowed("inbound", "adapters/outbound/postgres/database.ts")).toBe(
			false,
		);
		expect(allowed("outbound", "application/sale-service.ts")).toBe(false);
		expect(allowed("outbound", "adapters/inbound/http/app.ts")).toBe(false);
		// The domain reads no clock and waits on nothing, so the timer helper is refused there.
		expect(allowed("domain", "@flash/flash-commons/timers")).toBe(false);
		expect(allowed("application", "@flash/flash-commons/timers-extras")).toBe(
			false,
		);
		// The application reads no clock, no randomness and no timer of its own: the wiring passes them in.
		expect(allowed("application", "@flash/flash-commons/timers")).toBe(false);
		expect(allowed("application", "node:crypto")).toBe(false);
		expect(allowed("application", "node:fs")).toBe(false);
		// The domain takes from node only what it really uses: the hash and the signature of the ticket and the token.
		expect(allowed("domain", "node:fs")).toBe(false);
		expect(allowed("domain", "node:crypto")).toBe(true);
	});

	// The scan finds every way a module can be loaded: `import ... from`, the bare `import "x"` that runs for its side
	// effects, and the dynamic `import("x")`. A rule that misses one of them is no rule.
	describe("the import scan", () => {
		const file = path.join(SRC, "application/example.ts");
		const targets = (text: string) =>
			importsIn(file, text).map((imp) => imp.target);

		it("sees an import from a package or a file", () => {
			expect(targets('import { x } from "node:fs";')).toEqual(["node:fs"]);
		});

		it("sees a bare import, which loads a module for its side effects", () => {
			expect(targets('import "node:fs";')).toEqual(["node:fs"]);
		});

		it("sees a dynamic import, which loads a module when it runs", () => {
			expect(targets('const fs = await import("node:fs");')).toEqual([
				"node:fs",
			]);
		});

		it("still tells a type-only import, which loads nothing, from a value import", () => {
			expect(importsIn(file, 'import type { X } from "node:fs";')).toEqual([
				{ from: file, target: "node:fs", typeOnly: true },
			]);
		});
	});

	it("accepts the imports the rules allow", () => {
		expect(allowed("domain", "node:crypto")).toBe(true);
		expect(allowed("domain", "@flash/typekit")).toBe(true);
		expect(allowed("application", "@flash/typekit")).toBe(true);
		expect(allowed("domain", "@flash/flash-commons")).toBe(true);
		expect(allowed("application", "@flash/flash-commons")).toBe(true);
		expect(allowed("inbound", "fastify")).toBe(true);
		expect(allowed("application", "application/ports/clock.ts")).toBe(true);
		expect(allowed("outbound", "application/ports/clock.ts")).toBe(true);
		expect(allowed("outbound", "domain/sale.ts")).toBe(true);
		expect(allowed("inbound", "application/dependencies.ts")).toBe(true);
	});
});

// The folder of the route files, which take every path from the table in @flash/flash-commons.
const ROUTES = path.join(SRC, "adapters/inbound/http/routes");
// A quote or a backtick followed by a slash and a letter opens a path. Whole-line and trailing comments are cut first, so a
// path named in prose does not count.
const PATH_LITERAL = /["'`]\/[a-z]/;
const LINE_COMMENT = /(^|\s)\/\/.*$/gm;

// True when `text` writes a path as a string or a template, outside its comments. Exported so the rule is tested on samples.
export function pathLiteralsIn(text: string): boolean {
	return PATH_LITERAL.test(text.replace(LINE_COMMENT, ""));
}

// The route files take every path from the table in @flash/flash-commons, so the routes read one list. A string that starts
// with a slash in the code (not in a comment) is a path written by hand, and is refused.
describe("the route files", () => {
	it("sees a path written as a string or a template", () => {
		expect(pathLiteralsIn('url: "/sales/current"')).toBe(true);
		expect(pathLiteralsIn("url: `/sales/current`")).toBe(true);
	});

	it("does not count a path named in a comment, or a path taken from the table", () => {
		expect(pathLiteralsIn("// The `/health` probe.\nconst x = 1;")).toBe(false);
		expect(pathLiteralsIn("url: API_PATHS.sale")).toBe(false);
	});

	it("writes no path of its own: each one takes its path from the table", () => {
		// A test writes the paths it expects, as the route-table test does, so only product files are checked.
		const writers = walk(ROUTES)
			.filter((file) => file.endsWith(".ts") && !file.endsWith("_tests.ts"))
			.filter((file) => pathLiteralsIn(readFileSync(file, "utf8")))
			.map((file) => path.relative(SRC, file));
		expect(writers).toEqual([]);
	});
});
