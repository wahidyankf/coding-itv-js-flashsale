import { describe, expect, it } from "vitest";
import { loadSale } from "./load";

const ENV = { FLASH_BE_URL: "http://flash-be.test" };

describe("loadSale", () => {
	it("reads the current sale", async () => {
		const urls: string[] = [];
		const fetcher: typeof fetch = async (input) => {
			urls.push(String(input));
			return Response.json({ id: "s1", remaining: 4 });
		};
		expect(await loadSale(ENV, fetcher)).toEqual({
			state: "ok",
			sale: { id: "s1", remaining: 4 },
		});
		expect(urls).toEqual(["http://flash-be.test/sales/current"]);
	});

	it("tells a missing sale from a failure", async () => {
		const none: typeof fetch = async () =>
			Response.json({ error: "sale_not_found" }, { status: 404 });
		const broken: typeof fetch = async () => new Response("x", { status: 500 });
		const down: typeof fetch = async () => {
			throw new TypeError("fetch failed");
		};
		expect(await loadSale(ENV, none)).toEqual({ state: "none" });
		expect(await loadSale(ENV, broken)).toEqual({ state: "error" });
		expect(await loadSale(ENV, down)).toEqual({ state: "error" });
	});

	it("uses the global fetch by default", async () => {
		expect((await loadSale({ FLASH_BE_URL: "http://127.0.0.1:1" })).state).toBe(
			"error",
		);
	});
});
