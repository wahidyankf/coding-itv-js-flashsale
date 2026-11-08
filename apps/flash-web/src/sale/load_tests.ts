// Unit tests for loading the sale on the server: a sale, no sale, and a sale that cannot be read.
import { describe, expect, it } from "vitest";
import { loadSale } from "./load";
import type { SaleView } from "./types";

const ENV = { FLASH_BE_URL: "http://flash-be.test" };
const SALE: SaleView = {
	id: "11111111-1111-4111-8111-111111111111",
	productId: "22222222-2222-4222-8222-222222222222",
	name: "Drop",
	status: "active",
	startsAt: "2026-06-01T11:00:00.000Z",
	endsAt: "2026-06-01T13:00:00.000Z",
	stock: 10,
	remaining: 4,
};

describe("loadSale", () => {
	it("reads the current sale", async () => {
		const urls: string[] = [];
		const fetcher: typeof fetch = async (input) => {
			urls.push(String(input));
			return Response.json(SALE);
		};
		expect(await loadSale(ENV, fetcher)).toEqual({
			state: "ok",
			sale: SALE,
		});
		expect(urls).toEqual(["http://flash-be.test/api/v1/sales/current"]);
	});

	it("tells a missing sale from a failure", async () => {
		const none: typeof fetch = async () =>
			Response.json(
				{ errorCode: "sale_not_found", errorMessage: "No sale was found." },
				{ status: 404 },
			);
		const broken: typeof fetch = async () => new Response("x", { status: 500 });
		const down: typeof fetch = async () => {
			throw new TypeError("fetch failed");
		};
		expect(await loadSale(ENV, none)).toEqual({ state: "none" });
		expect(await loadSale(ENV, broken)).toEqual({ state: "error" });
		expect(await loadSale(ENV, down)).toEqual({ state: "error" });
	});

	it("calls a sale that does not decode a sale that cannot be read", async () => {
		const broken: typeof fetch = async () =>
			Response.json({ ...SALE, status: "closed" });
		expect(await loadSale(ENV, broken)).toEqual({ state: "error" });
	});

	it("uses the global fetch by default", async () => {
		expect((await loadSale({ FLASH_BE_URL: "http://127.0.0.1:1" })).state).toBe(
			"error",
		);
	});
});
