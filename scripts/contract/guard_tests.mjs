import path from "node:path";
import { describe, expect, it } from "vitest";
import { findViolations, violationsIn } from "./guard.mjs";

describe("the contract guard", () => {
	it("finds an API path in a string", () => {
		expect(violationsIn('const url = "/sales/current";')).toHaveLength(1);
		expect(violationsIn('const url = "/admin/sales";')).toHaveLength(1);
	});

	it("finds an API path in a template", () => {
		expect(
			violationsIn("const url = `" + "$" + "{base}/sales/queue`;"),
		).toHaveLength(1);
	});

	it("finds the ticket header written by hand", () => {
		expect(violationsIn('const t = headers["x-queue-ticket"];')).toHaveLength(
			1,
		);
	});

	it("lets a comment name a path", () => {
		expect(violationsIn("// such as `/sales/current`")).toHaveLength(0);
		expect(violationsIn(" * the /sales/ routes")).toHaveLength(0);
	});

	it("lets code use the contract", () => {
		expect(
			violationsIn("const url = pathOf(routes.sale, input);"),
		).toHaveLength(0);
	});

	it("finds nothing in the product code of the repository", () => {
		expect(findViolations(path.resolve(import.meta.dirname, "../.."))).toEqual(
			[],
		);
	});
});
