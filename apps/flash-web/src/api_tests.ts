// Unit tests for the one call the page makes to flash-be: a 2xx reply is read as the caller's type only when it decodes,
// a refusal is read as an error with its wait, and every answer the page cannot read is the one "unexpected" failure.
import { integer, object } from "@flash/flash-commons";
import { Err, Ok } from "@flash/typekit";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { callApi } from "./api";

const UNEXPECTED = new Err({
	errorCode: "unexpected",
	errorMessage: "The server sent a reply that this app cannot read.",
});
const NETWORK = new Err({
	errorCode: "network",
	errorMessage: "The server could not be reached.",
});
const RATE_LIMITED = { errorCode: "rate_limited", errorMessage: "Too many." };

const COUNT = "https://flash-be.test/count";
const decodeCount = object({ n: integer });

// A fetch that gives the one reply it is asked for.
function fetcherOf(reply: () => Response | Promise<Response>) {
	return vi.fn(async (_url: unknown, _init?: RequestInit) => reply());
}

// A failed decode is reported to the console by default. The tests that do not look at the report keep the output quiet.
beforeEach(() => {
	vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
	vi.restoreAllMocks();
});

describe("callApi, a reply that succeeded", () => {
	it("gives the decoded body, and drops keys the decoder does not name", async () => {
		const fetcher = fetcherOf(() => Response.json({ n: 1, extra: true }));
		expect(await callApi(fetcher as typeof fetch, COUNT, decodeCount)).toEqual(
			new Ok({ n: 1 }),
		);
	});

	it("calls a body that does not decode unexpected", async () => {
		const fetcher = fetcherOf(() => Response.json({ n: "1" }));
		expect(await callApi(fetcher as typeof fetch, COUNT, decodeCount)).toEqual(
			UNEXPECTED,
		);
	});

	it("calls a body with a missing field unexpected", async () => {
		const fetcher = fetcherOf(() => Response.json({}));
		expect(await callApi(fetcher as typeof fetch, COUNT, decodeCount)).toEqual(
			UNEXPECTED,
		);
	});

	it("calls a body that is not JSON unexpected", async () => {
		const fetcher = fetcherOf(() => new Response("<html>", { status: 200 }));
		expect(await callApi(fetcher as typeof fetch, COUNT, decodeCount)).toEqual(
			UNEXPECTED,
		);
	});

	it("calls an empty body unexpected", async () => {
		const fetcher = fetcherOf(() => new Response(null, { status: 200 }));
		expect(await callApi(fetcher as typeof fetch, COUNT, decodeCount)).toEqual(
			UNEXPECTED,
		);
	});

	it("sends the init it is given", async () => {
		const fetcher = fetcherOf(() => Response.json({ n: 1 }));
		await callApi(fetcher as typeof fetch, COUNT, decodeCount, {
			method: "POST",
		});
		expect(fetcher.mock.calls[0]?.[1]).toEqual({ method: "POST" });
	});
});

describe("callApi, a refusal", () => {
	it("gives the code, the sentence and the wait in the header", async () => {
		const fetcher = fetcherOf(
			() =>
				new Response(
					JSON.stringify({ ...RATE_LIMITED, retryAfterSeconds: 9 }),
					{
						status: 429,
						headers: { "retry-after": "7" },
					},
				),
		);
		expect(await callApi(fetcher as typeof fetch, COUNT, decodeCount)).toEqual(
			new Err({ ...RATE_LIMITED, retryAfterSeconds: 7 }),
		);
	});

	it("gives the wait from the body when the header has none", async () => {
		const fetcher = fetcherOf(() =>
			Response.json({ ...RATE_LIMITED, retryAfterSeconds: 3 }, { status: 429 }),
		);
		expect(await callApi(fetcher as typeof fetch, COUNT, decodeCount)).toEqual(
			new Err({ ...RATE_LIMITED, retryAfterSeconds: 3 }),
		);
	});

	it("leaves the wait out when neither the header nor the body has one", async () => {
		const fetcher = fetcherOf(() =>
			Response.json(
				{ errorCode: "sold_out", errorMessage: "No items are left." },
				{ status: 409 },
			),
		);
		const failure = await callApi(fetcher as typeof fetch, COUNT, decodeCount);
		expect(failure).toEqual(
			new Err({ errorCode: "sold_out", errorMessage: "No items are left." }),
		);
	});

	it.each([
		["a code that is not text", { errorCode: 5, errorMessage: "x" }],
		["no sentence", { errorCode: "sold_out" }],
		[
			"a wait that is not a whole number",
			{ ...RATE_LIMITED, retryAfterSeconds: 1.5 },
		],
		["a body that is a list", [RATE_LIMITED]],
	])("calls a refusal with %s unexpected", async (_name, body) => {
		const fetcher = fetcherOf(() => Response.json(body, { status: 400 }));
		expect(await callApi(fetcher as typeof fetch, COUNT, decodeCount)).toEqual(
			UNEXPECTED,
		);
	});

	it("calls a refusal that is not JSON unexpected", async () => {
		const fetcher = fetcherOf(() => new Response("no", { status: 500 }));
		expect(await callApi(fetcher as typeof fetch, COUNT, decodeCount)).toEqual(
			UNEXPECTED,
		);
	});
});

describe("callApi, no answer", () => {
	it("reports the network when nothing answers", async () => {
		const fetcher = fetcherOf(() => {
			throw new TypeError("fetch failed");
		});
		expect(await callApi(fetcher as typeof fetch, COUNT, decodeCount)).toEqual(
			NETWORK,
		);
	});
});

describe("callApi, what it reports", () => {
	it("reports a 2xx body that does not decode, once, with its URL, field and expected", async () => {
		const report = vi.fn();
		const fetcher = fetcherOf(() => Response.json({ n: "1" }));
		await callApi(fetcher as typeof fetch, COUNT, decodeCount, {}, report);
		expect(report).toHaveBeenCalledOnce();
		expect(report).toHaveBeenCalledWith({
			source: COUNT,
			path: "n",
			expected: "an integer",
		});
	});

	it("reports a missing field by its name", async () => {
		const report = vi.fn();
		const fetcher = fetcherOf(() => Response.json({}));
		await callApi(fetcher as typeof fetch, COUNT, decodeCount, {}, report);
		expect(report).toHaveBeenCalledWith({
			source: COUNT,
			path: "n",
			expected: "an integer",
		});
	});

	it("never carries the value of the body into the report", async () => {
		const report = vi.fn();
		const fetcher = fetcherOf(() =>
			Response.json({ n: "1", user: "shopper-name-xyz" }),
		);
		await callApi(fetcher as typeof fetch, COUNT, decodeCount, {}, report);
		expect(JSON.stringify(report.mock.calls)).not.toContain("shopper-name-xyz");
	});

	it("reports a refusal that does not decode, once", async () => {
		const report = vi.fn();
		const fetcher = fetcherOf(() =>
			Response.json({ errorCode: 5, errorMessage: "x" }, { status: 400 }),
		);
		await callApi(fetcher as typeof fetch, COUNT, decodeCount, {}, report);
		expect(report).toHaveBeenCalledOnce();
		expect(report).toHaveBeenCalledWith({
			source: COUNT,
			path: "errorCode",
			expected: "text",
		});
	});

	it("does not report a reply that decodes", async () => {
		const report = vi.fn();
		const fetcher = fetcherOf(() => Response.json({ n: 1 }));
		await callApi(fetcher as typeof fetch, COUNT, decodeCount, {}, report);
		expect(report).not.toHaveBeenCalled();
	});

	it("does not report a body that is not JSON, because it names no field", async () => {
		const report = vi.fn();
		const fetcher = fetcherOf(() => new Response("<html>", { status: 200 }));
		await callApi(fetcher as typeof fetch, COUNT, decodeCount, {}, report);
		expect(report).not.toHaveBeenCalled();
	});

	it("does not report a connection that failed", async () => {
		const report = vi.fn();
		const fetcher = fetcherOf(() => {
			throw new TypeError("fetch failed");
		});
		await callApi(fetcher as typeof fetch, COUNT, decodeCount, {}, report);
		expect(report).not.toHaveBeenCalled();
	});
});
