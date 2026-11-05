import { describe, expect, it } from "vitest";
import { fetchBackendHealth } from "./backend";

function fakeFetch(response: () => Response | Promise<Response>): typeof fetch {
	return async () => response();
}

describe("fetchBackendHealth", () => {
	it("returns ok when flash-be reports ok", async () => {
		const status = await fetchBackendHealth(
			"http://be",
			fakeFetch(() => Response.json({ status: "ok" })),
		);

		expect(status).toBe("ok");
	});

	it("returns down on a non-2xx response", async () => {
		const status = await fetchBackendHealth(
			"http://be",
			fakeFetch(() => new Response("nope", { status: 500 })),
		);

		expect(status).toBe("down");
	});

	it("returns down when the body status is not ok", async () => {
		const status = await fetchBackendHealth(
			"http://be",
			fakeFetch(() => Response.json({ status: "starting" })),
		);

		expect(status).toBe("down");
	});

	it("returns down when the network call throws", async () => {
		const status = await fetchBackendHealth("http://be", async () => {
			throw new TypeError("fetch failed");
		});

		expect(status).toBe("down");
	});
});
