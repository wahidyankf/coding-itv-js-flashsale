// Unit tests for the Redis hold gate's reply reading, the arguments it sends, and its owner-checked rebuild lock. A fake
// client stands in for Redis: the scripts run in Redis, so their end-to-end behaviour is in the integration tests.

import { Err, Ok } from "@flash/typekit";
import { describe, expect, it } from "vitest";
import { usernameOf } from "../../../bdd/support/users.js";
import type { RedisClient } from "./redis-client.js";
import {
	createRedisHoldGate,
	gateAnswerOf,
	restoreArguments,
} from "./redis-hold-gate.js";

const EXPIRES_MS = 1_700_000_000_000;

describe("the reply of the reserve script", () => {
	it.each([
		["sold out", [0], new Ok({ kind: "sold_out" })],
		["purchased", [2], new Ok({ kind: "purchased" })],
		["not ready", [4], new Ok({ kind: "not_ready" })],
		[
			"reserved",
			[1, "r-1", String(EXPIRES_MS)],
			new Ok({
				kind: "reserved",
				reservationId: "r-1",
				expiresAt: new Date(EXPIRES_MS),
			}),
		],
		[
			"already holding",
			[3, "r-1", String(EXPIRES_MS)],
			new Ok({
				kind: "held",
				reservationId: "r-1",
				expiresAt: new Date(EXPIRES_MS),
			}),
		],
	])("reads a %s answer", (_name, reply, expected) => {
		expect(gateAnswerOf(reply)).toEqual(expected);
	});

	// A reply the script does not write is a failure value: it must never become an answer by guesswork.
	it.each([
		["an unknown code", [9]],
		["no code", []],
		["a reply that is not a list", "reserved"],
		["a hold answer with no reservation id", [1, null, String(EXPIRES_MS)]],
		["a hold answer with no expiry", [3, "r-1"]],
		["a hold answer with an expiry that is not a number", [1, "r-1", "soon"]],
	])("refuses %s as unreadable", (_name, reply) => {
		expect(gateAnswerOf(reply)).toEqual(new Err("unreadable_reply"));
	});
});

describe("the arguments of the restore script", () => {
	it("counts the buyers, then the holds with their reservation ids and expiry", () => {
		expect(
			restoreArguments({
				buyers: [usernameOf("ana")],
				holds: [
					{
						user: usernameOf("ben"),
						reservationId: "r-b",
						expiresAt: new Date(1000),
					},
				],
			}),
		).toEqual(["1", "ana", "1", "ben", "r-b", "1000"]);
	});

	it("sends two zero counts for an empty snapshot", () => {
		expect(restoreArguments({ buyers: [], holds: [] })).toEqual(["0", "0"]);
	});
});

// A fake client that records the calls. MULTI and a plain DEL throw: the gate must not use them for these steps.
function fakeRedis() {
	const calls: Array<{ command: string; args: unknown[] }> = [];
	const client = {
		eval: async (script: string, options: unknown) => {
			calls.push({ command: "eval", args: [script, options] });
			return 1;
		},
		set: async (key: string, value: string, options: unknown) => {
			calls.push({ command: "set", args: [key, value, options] });
			return "OK";
		},
		multi: () => {
			throw new Error("the gate does not use MULTI");
		},
		del: async () => {
			throw new Error("the rebuild lock is not deleted without its owner");
		},
	};
	return { client: client as unknown as RedisClient, calls };
}

describe("the rebuild of a sale in the Redis gate", () => {
	it("restores the state in one script, with the four keys of the sale", async () => {
		const { client, calls } = fakeRedis();
		await createRedisHoldGate(client).restore("s-1", {
			buyers: [],
			holds: [],
		});
		expect(calls).toHaveLength(1);
		expect(calls[0]?.command).toBe("eval");
		expect(calls[0]?.args[1]).toEqual({
			keys: [
				"sale:s-1:buyers",
				"sale:s-1:holds",
				"sale:s-1:ids",
				"sale:s-1:ready",
			],
			arguments: ["0", "0"],
		});
	});

	it("takes the rebuild lock under the owner's token", async () => {
		const { client, calls } = fakeRedis();
		expect(
			await createRedisHoldGate(client).lockRebuild("s-1", 500, "me"),
		).toBe(true);
		expect(calls[0]?.args[0]).toBe("sale:s-1:rebuild-lock");
		expect(calls[0]?.args[1]).toBe("me");
	});

	it("releases the rebuild lock by a compare-and-delete on the owner's token", async () => {
		const { client, calls } = fakeRedis();
		await createRedisHoldGate(client).unlockRebuild("s-1", "me");
		expect(calls[0]?.command).toBe("eval");
		expect(calls[0]?.args[1]).toEqual({
			keys: ["sale:s-1:rebuild-lock"],
			arguments: ["me"],
		});
	});
});
