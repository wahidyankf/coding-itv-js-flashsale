import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// The hexagon: the domain knows nothing, the application knows the domain, and adapters know both but never each
// other. Only the entry points (main, composition, migrate, seed-sale) wire adapters to ports.
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

// Every import and re-export, as written. Relative targets are resolved to a path under src.
function importsOf(file: string): Import[] {
	const text = readFileSync(file, "utf8");
	const found = [
		...text.matchAll(
			/\b(?:import|export)(\s+type)?\b[^;"]*?\bfrom\s+"([^"]+)"/g,
		),
	];
	return found.flatMap((match) => {
		const spec = match[2];
		const typeOnly = match[1] !== undefined;
		if (spec === undefined) return [];
		if (!spec.startsWith(".")) return [{ from: file, target: spec, typeOnly }];
		const resolved = path.resolve(
			path.dirname(file),
			spec.replace(/\.js$/, ".ts"),
		);
		return [{ from: file, target: path.relative(SRC, resolved), typeOnly }];
	});
}

const files = walk(SRC).filter((file) => file.endsWith(".ts"));
const product = files.filter((file) => layerOf(file) !== "test");

const isNode = (target: string) => target.startsWith("node:");
// The typekit library has no dependencies of its own and no I/O, so the inner layers may use it.
const isKernel = (target: string) => target === "@flash/typekit";
// The vocabulary of the contract (format rules, error codes) has no dependency and no I/O, so the inner layers may use
// it. The rest of the contract holds Zod, so they may only name its types.
const isVocabulary = (target: string) =>
	target === "@flash/contract/vocabulary";
const isContractType = (target: string, typeOnly: boolean) =>
	typeOnly && target === "@flash/contract";
const isDomain = (target: string) => target.startsWith("domain/");
const isPort = (target: string) => target.startsWith("application/ports/");
const isWiring = (target: string) =>
	target.startsWith("composition") || target.startsWith("config");

// What a layer may import. A package name or a path outside the list is a violation.
function allowed(layer: Layer, target: string, typeOnly = false): boolean {
	switch (layer) {
		case "domain":
			return (
				isNode(target) ||
				isKernel(target) ||
				isVocabulary(target) ||
				isDomain(target)
			);
		case "application":
			return (
				isNode(target) ||
				isKernel(target) ||
				isVocabulary(target) ||
				isContractType(target, typeOnly) ||
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
		.filter((imp) => !allowed(layer, imp.target, imp.typeOnly))
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

	it("rejects the imports the rules forbid", () => {
		expect(allowed("domain", "application/sale-service.ts")).toBe(false);
		expect(allowed("domain", "kysely")).toBe(false);
		expect(
			allowed("application", "adapters/outbound/redis/redis-client.ts"),
		).toBe(false);
		expect(allowed("application", "fastify")).toBe(false);
		expect(allowed("domain", "@flash/typekit-extras")).toBe(false);
		expect(allowed("domain", "@flash/contract")).toBe(false);
		expect(allowed("domain", "@flash/contract", true)).toBe(false);
		expect(allowed("application", "@flash/contract")).toBe(false);
		expect(allowed("inbound", "adapters/outbound/postgres/database.ts")).toBe(
			false,
		);
		expect(allowed("outbound", "application/sale-service.ts")).toBe(false);
		expect(allowed("outbound", "adapters/inbound/http/app.ts")).toBe(false);
	});

	it("accepts the imports the rules allow", () => {
		expect(allowed("domain", "node:crypto")).toBe(true);
		expect(allowed("domain", "@flash/typekit")).toBe(true);
		expect(allowed("application", "@flash/typekit")).toBe(true);
		expect(allowed("domain", "@flash/contract/vocabulary")).toBe(true);
		expect(allowed("application", "@flash/contract/vocabulary")).toBe(true);
		expect(allowed("application", "@flash/contract", true)).toBe(true);
		expect(allowed("inbound", "@flash/contract")).toBe(true);
		expect(allowed("application", "application/ports/clock.ts")).toBe(true);
		expect(allowed("outbound", "application/ports/clock.ts")).toBe(true);
		expect(allowed("outbound", "domain/sale.ts")).toBe(true);
		expect(allowed("inbound", "application/dependencies.ts")).toBe(true);
	});
});
