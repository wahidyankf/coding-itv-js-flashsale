// Unit tests for the decode report: one warning line that names the source and the field, and nothing of the value.
import { afterEach, describe, expect, it, vi } from "vitest";
import { reportDecodeFailure } from "./decode-report";

afterEach(() => {
	vi.restoreAllMocks();
});

describe("reportDecodeFailure", () => {
	it("warns once, naming the source, the field and what was expected", () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		reportDecodeFailure({
			source: "http://flash-be.test/api/sales/x",
			path: "sale.stock",
			expected: "an integer",
		});
		expect(warn).toHaveBeenCalledOnce();
		expect(warn).toHaveBeenCalledWith(
			'flash-web: http://flash-be.test/api/sales/x sent a value that did not decode at field "sale.stock", expected an integer.',
		);
	});

	it("says the top level when the failure is at the root", () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		reportDecodeFailure({ source: "/x", path: "", expected: "an object" });
		expect(warn).toHaveBeenCalledWith(
			"flash-web: /x sent a value that did not decode at the top level, expected an object.",
		);
	});
});
