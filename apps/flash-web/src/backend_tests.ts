// Unit tests for the web server's look at flash-be's health: "ok" only for a reply that decodes to ok, and "down" for
// anything else, including a reply the page cannot read.
import { Err, Ok } from "@flash/typekit";
import { describe, expect, it, vi } from "vitest";
import { decodeBackendHealth, fetchBackendHealth } from "./backend";

const BASE = "http://flash-be.test";

describe("decodeBackendHealth", () => {
	it("reads ok", () => {
		expect(decodeBackendHealth({ status: "ok" })).toEqual(
			new Ok({ status: "ok" }),
		);
	});

	it("refuses any other status, and a missing one", () => {
		expect(decodeBackendHealth({ status: "down" })).toEqual(
			new Err({ path: "status", expected: 'the text "ok"' }),
		);
		expect(decodeBackendHealth({})).toEqual(
			new Err({ path: "status", expected: 'the text "ok"' }),
		);
	});
});

describe("fetchBackendHealth", () => {
	it.each([
		["a reply that says ok", () => Response.json({ status: "ok" }), "ok"],
		["a reply that says down", () => Response.json({ status: "down" }), "down"],
		["a reply with no status", () => Response.json({}), "down"],
		["a reply that is not JSON", () => new Response("<html>"), "down"],
		[
			"no reply at all",
			() => {
				throw new TypeError("fetch failed");
			},
			"down",
		],
	])("says %s is %s", async (_name, reply, status) => {
		const fetcher = vi.fn(async () => reply());
		expect(await fetchBackendHealth(BASE, fetcher as typeof fetch)).toBe(
			status,
		);
		expect(fetcher).toHaveBeenCalledWith(`${BASE}/health`, {});
	});
});
