// Unit tests for the Nitro plugin end-streams.ts: starting the server makes it end the proxied streams on a stop signal.
import { describe, expect, it, vi } from "vitest";
import { endStreamsOnStop, proxiedStreams } from "../stream-closer";
import endStreams from "./end-streams";

// The real listener would stay on this test process; the plugin only has to ask for it.
vi.mock("../stream-closer", async (original) => ({
	...(await original<typeof import("../stream-closer")>()),
	endStreamsOnStop: vi.fn(),
}));

describe("the end-streams plugin", () => {
	it("makes the server end the streams the proxy tracks when it is asked to stop", () => {
		endStreams();
		expect(endStreamsOnStop).toHaveBeenCalledExactlyOnceWith(proxiedStreams);
	});
});
