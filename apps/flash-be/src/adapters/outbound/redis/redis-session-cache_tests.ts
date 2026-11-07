import { describe, expect, it } from "vitest";
import type { SessionStore } from "../../../application/ports/session-store.js";
import type { Principal } from "../../../domain/auth.js";
import type { RedisClient } from "./redis-client.js";
import { createRedisSessionCache } from "./redis-session-cache.js";

const NOW = new Date("2026-06-01T12:00:00Z");
const ANA: Principal = { userId: "user-1", username: "ana", role: "shopper" };
const ENDS = new Date(NOW.getTime() + 600_000);

// A Redis with the three commands the cache uses. `down` makes every command fail, as a lost connection does.
function fakeRedis(down = false) {
	const values = new Map<string, string>();
	const ttl = new Map<string, number>();
	const fail = () => {
		throw new Error("redis is down");
	};
	const client = {
		get: async (key: string) => (down ? fail() : (values.get(key) ?? null)),
		set: async (key: string, value: string, options: { EX: number }) => {
			if (down) fail();
			values.set(key, value);
			ttl.set(key, options.EX);
			return "OK";
		},
		del: async (keys: string | string[]) => {
			if (down) fail();
			for (const key of [keys].flat()) values.delete(key);
			return 1;
		},
	};
	return { client: client as unknown as RedisClient, values, ttl };
}

function innerStore() {
	const calls = { find: 0, revoke: 0, rotate: 0 };
	const store: SessionStore = {
		create: async () => {},
		findByAccess: async () => {
			calls.find += 1;
			return { principal: ANA, expiresAt: ENDS };
		},
		rotate: async () => {
			calls.rotate += 1;
			return { principal: ANA, ended: ["old-hash"] };
		},
		revoke: async () => {
			calls.revoke += 1;
			return ["other-hash"];
		},
	};
	return { store, calls };
}

describe("the cache of logins", () => {
	it("reads Postgres on a miss, remembers the answer, and then answers without it", async () => {
		const redis = fakeRedis();
		const { store, calls } = innerStore();
		const cached = createRedisSessionCache(store, redis.client);
		const first = await cached.findByAccess("hash", NOW);
		const second = await cached.findByAccess("hash", NOW);
		expect(first?.principal).toEqual(ANA);
		expect(second).toEqual({ principal: ANA, expiresAt: ENDS });
		expect(calls.find).toBe(1);
	});

	it("keeps an answer for a minute at most, and never past the end of the token", async () => {
		const redis = fakeRedis();
		const cached = createRedisSessionCache(innerStore().store, redis.client);
		await cached.findByAccess("long", NOW);
		expect(redis.ttl.get("session:long")).toBe(60);
		const soon = {
			...innerStore().store,
			findByAccess: async () => ({
				principal: ANA,
				expiresAt: new Date(NOW.getTime() + 20_000),
			}),
		};
		await createRedisSessionCache(soon, redis.client).findByAccess("soon", NOW);
		expect(redis.ttl.get("session:soon")).toBe(20);
	});

	it("does not remember a token that ends within the second", async () => {
		const redis = fakeRedis();
		const ending = {
			...innerStore().store,
			findByAccess: async () => ({
				principal: ANA,
				expiresAt: new Date(NOW.getTime() + 500),
			}),
		};
		await createRedisSessionCache(ending, redis.client).findByAccess("x", NOW);
		expect(redis.values.size).toBe(0);
	});

	it("reads Postgres when the remembered entry is not readable, instead of failing the login", async () => {
		const redis = fakeRedis();
		redis.values.set("session:hash", "not json");
		const { store, calls } = innerStore();
		const cached = createRedisSessionCache(store, redis.client);
		expect((await cached.findByAccess("hash", NOW))?.principal).toEqual(ANA);
		expect(calls.find).toBe(1);
	});

	it("does not remember an unknown token", async () => {
		const redis = fakeRedis();
		const unknown = {
			...innerStore().store,
			findByAccess: async () => undefined,
		};
		const found = await createRedisSessionCache(
			unknown,
			redis.client,
		).findByAccess("x", NOW);
		expect(found).toBeUndefined();
		expect(redis.values.size).toBe(0);
	});

	it("falls back to Postgres while Redis is down", async () => {
		const { store, calls } = innerStore();
		const cached = createRedisSessionCache(store, fakeRedis(true).client);
		expect((await cached.findByAccess("hash", NOW))?.principal).toEqual(ANA);
		expect((await cached.findByAccess("hash", NOW))?.principal).toEqual(ANA);
		expect(calls.find).toBe(2);
	});

	it("forgets the tokens that a logout ends, the one sent and the ones Postgres names", async () => {
		const redis = fakeRedis();
		const { store } = innerStore();
		const cached = createRedisSessionCache(store, redis.client);
		redis.values.set("session:sent", "{}");
		redis.values.set("session:other-hash", "{}");
		const ended = await cached.revoke({ accessHash: "sent" });
		expect(ended).toEqual(["other-hash"]);
		expect(redis.values.size).toBe(0);
	});

	it("forgets the access token that a refresh replaces", async () => {
		const redis = fakeRedis();
		const { store } = innerStore();
		const cached = createRedisSessionCache(store, redis.client);
		redis.values.set("session:old-hash", "{}");
		const rotated = await cached.rotate({
			presentedRefreshHash: "r",
			accessHash: "a",
			accessExpiresAt: ENDS,
			refreshHash: "r2",
			refreshExpiresAt: ENDS,
			now: NOW,
		});
		expect(rotated.principal).toEqual(ANA);
		expect(redis.values.size).toBe(0);
	});

	it("still logs out and refreshes while Redis is down", async () => {
		const { store, calls } = innerStore();
		const cached = createRedisSessionCache(store, fakeRedis(true).client);
		await cached.revoke({ refreshHash: "r" });
		await cached.rotate({
			presentedRefreshHash: "r",
			accessHash: "a",
			accessExpiresAt: ENDS,
			refreshHash: "r2",
			refreshExpiresAt: ENDS,
			now: NOW,
		});
		expect(calls.revoke).toBe(1);
		expect(calls.rotate).toBe(1);
	});

	it("passes a new login on to Postgres", async () => {
		let created = 0;
		const { store } = innerStore();
		const cached = createRedisSessionCache(
			{
				...store,
				create: async () => {
					created += 1;
				},
			},
			fakeRedis().client,
		);
		await cached.create({
			userId: "u",
			accessHash: "a",
			accessExpiresAt: ENDS,
			refreshHash: "r",
			refreshExpiresAt: ENDS,
		});
		expect(created).toBe(1);
	});
});
