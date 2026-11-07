// The auth service: the branches no shopper scenario reaches by itself, the operator checks, and the refresh and logout edges.
import { Err, Ok } from "@flash/typekit";
import { describe, expect, it } from "vitest";
import { randomTokenSource } from "../adapters/outbound/crypto/token-source.js";
import { memoryAuth, plainHasher } from "../bdd/support/memory-auth.js";
import { usernameOf } from "../bdd/support/users.js";
import { ACCESS_TTL_SECONDS, REFRESH_TTL_SECONDS } from "../domain/auth.js";
import { userIdOf } from "../domain/user.js";
import { createAuthService } from "./auth-service.js";

// The branches of the auth service that no scenario of a shopper reaches by itself.
const START = new Date("2026-06-01T12:00:00Z");
const PASSWORD = "a long password";
// The system user that makes the first operator. Only the id matters here, so any id will do.
const SYSTEM_ID = userIdOf("system-user-id");

function world() {
	let now = START;
	const auth = memoryAuth(() => now);
	return {
		service: auth.service,
		stored: auth.stored,
		advance: (seconds: number) => {
			now = new Date(now.getTime() + seconds * 1000);
		},
	};
}

describe("registering and logging in", () => {
	it("gives a login the two tokens and when each one ends", async () => {
		const { service } = world();
		const registered = await service.register(usernameOf("ana"), PASSWORD);
		expect(registered.isOk()).toBe(true);
		if (registered.isErr()) return;
		expect(registered.value.principal.role).toBe("shopper");
		expect(registered.value.accessExpiresAt.getTime()).toBe(
			START.getTime() + ACCESS_TTL_SECONDS * 1000,
		);
		expect(registered.value.refreshExpiresAt.getTime()).toBe(
			START.getTime() + REFRESH_TTL_SECONDS * 1000,
		);
		expect(registered.value.accessToken).not.toBe(
			registered.value.refreshToken,
		);
	});

	it("logs in with the name in any case", async () => {
		const { service } = world();
		await service.register(usernameOf("ana"), PASSWORD);
		expect((await service.login(usernameOf(" ANA "), PASSWORD)).isOk()).toBe(
			true,
		);
	});

	it("gives every login its own tokens", async () => {
		const { service } = world();
		await service.register(usernameOf("ana"), PASSWORD);
		const first = await service.login(usernameOf("ana"), PASSWORD);
		const second = await service.login(usernameOf("ana"), PASSWORD);
		expect(first.isOk() && second.isOk()).toBe(true);
		if (first.isErr() || second.isErr()) return;
		expect(first.value.accessToken).not.toBe(second.value.accessToken);
		const known = await service.authenticate(first.value.accessToken);
		expect(known.isOk()).toBe(true);
	});
});

describe("recognising a login", () => {
	it("refuses a missing token and an unknown one", async () => {
		const { service } = world();
		expect((await service.authenticate(undefined)).isErr()).toBe(true);
		expect((await service.authenticate("made-up")).isErr()).toBe(true);
	});

	it("refuses an access token once its 15 minutes have passed", async () => {
		const { service, advance } = world();
		const registered = await service.register(usernameOf("ana"), PASSWORD);
		if (registered.isErr()) throw new Error("no login");
		advance(ACCESS_TTL_SECONDS - 1);
		expect(
			(await service.authenticate(registered.value.accessToken)).isOk(),
		).toBe(true);
		advance(1);
		expect(
			(await service.authenticate(registered.value.accessToken)).isErr(),
		).toBe(true);
	});

	it("refuses an answer from a cache that outlived the token", async () => {
		const service = createAuthService(
			{
				register: async () => new Err("username_taken"),
				findCredentials: async () => undefined,
			},
			{
				create: async () => {},
				findByAccess: async () => ({
					principal: {
						userId: userIdOf("u"),
						username: usernameOf("ana"),
						role: "shopper",
					},
					expiresAt: new Date(START.getTime() - 1),
				}),
				rotate: async () => ({ principal: undefined, ended: [] }),
				revoke: async () => [],
			},
			plainHasher,
			() => START,
			randomTokenSource,
		);
		const found = await service.authenticate("any");
		expect(found.isErr() && found.error).toBe("not_authenticated");
	});
});

describe("refreshing", () => {
	it("refuses a refresh token that is unknown", async () => {
		const { service } = world();
		const refreshed = await service.refresh("made-up");
		expect(refreshed.isErr() && refreshed.error).toBe("invalid_refresh_token");
	});

	it("refuses a refresh token after its 7 days", async () => {
		const { service, advance } = world();
		const registered = await service.register(usernameOf("ana"), PASSWORD);
		if (registered.isErr()) throw new Error("no login");
		advance(REFRESH_TTL_SECONDS);
		const refreshed = await service.refresh(registered.value.refreshToken);
		expect(refreshed.isErr() && refreshed.error).toBe("invalid_refresh_token");
	});

	it("gives a new pair that works, and a new week", async () => {
		const { service, advance } = world();
		const registered = await service.register(usernameOf("ana"), PASSWORD);
		if (registered.isErr()) throw new Error("no login");
		advance(ACCESS_TTL_SECONDS + 1);
		const refreshed = await service.refresh(registered.value.refreshToken);
		if (refreshed.isErr()) throw new Error("no refresh");
		expect(
			(await service.authenticate(refreshed.value.accessToken)).isOk(),
		).toBe(true);
		expect(refreshed.value.refreshExpiresAt.getTime()).toBeGreaterThan(
			registered.value.refreshExpiresAt.getTime(),
		);
	});
});

describe("logging out", () => {
	it("ends the login by whichever token the client still has", async () => {
		const { service } = world();
		const one = await service.register(usernameOf("ana"), PASSWORD);
		const two = await service.login(usernameOf("ana"), PASSWORD);
		if (one.isErr() || two.isErr()) throw new Error("no login");
		await service.logout({ accessToken: one.value.accessToken });
		await service.logout({ refreshToken: two.value.refreshToken });
		expect((await service.authenticate(one.value.accessToken)).isErr()).toBe(
			true,
		);
		expect((await service.authenticate(two.value.accessToken)).isErr()).toBe(
			true,
		);
	});

	it("asks the store to end nothing when the client has no token", async () => {
		let asked: unknown;
		const service = createAuthService(
			{
				register: async () => new Err("username_taken"),
				findCredentials: async () => undefined,
			},
			{
				create: async () => {},
				findByAccess: async () => undefined,
				rotate: async () => ({ principal: undefined, ended: [] }),
				revoke: async (hashes) => {
					asked = hashes;
					return [];
				},
			},
			plainHasher,
			() => START,
			randomTokenSource,
		);
		await service.logout({});
		expect(asked).toEqual({ accessHash: undefined, refreshHash: undefined });
	});
});

describe("refreshing", () => {
	it("refuses a request that carries no refresh token", async () => {
		const { service } = world();
		const refreshed = await service.refresh(undefined);
		expect(refreshed.isErr()).toBe(true);
		if (refreshed.isOk()) return;
		expect(refreshed.error).toBe("invalid_refresh_token");
	});
});

describe("who may manage sales", () => {
	it("refuses no login as not_authenticated, and a shopper as forbidden", async () => {
		const { service } = world();
		const shopper = await service.register(usernameOf("ana"), PASSWORD);
		if (shopper.isErr()) throw new Error("no login");
		const none = await service.authorizeOperator(undefined);
		expect(none.isErr() && none.error).toBe("not_authenticated");
		const refused = await service.authorizeOperator(shopper.value.accessToken);
		expect(refused.isErr() && refused.error).toBe("forbidden");
	});

	it("lets through the operator that createOperator made", async () => {
		const { service } = world();
		const made = await service.createOperator(
			usernameOf("boss"),
			PASSWORD,
			SYSTEM_ID,
		);
		expect(made.isOk() && made.value.role).toBe("operator");
		const login = await service.login(usernameOf("boss"), PASSWORD);
		if (login.isErr()) throw new Error("no login");
		const who = await service.authorizeOperator(login.value.accessToken);
		expect(who.isOk() && who.value.username).toBe("boss");
	});

	it("records the system user as the one who made the operator", async () => {
		let recorded: unknown;
		const service = createAuthService(
			{
				register: async (account) => {
					recorded = account;
					return new Ok({
						userId: userIdOf("u"),
						username: account.username,
						role: account.role,
					});
				},
				findCredentials: async () => undefined,
			},
			{
				create: async () => {},
				findByAccess: async () => undefined,
				rotate: async () => ({ principal: undefined, ended: [] }),
				revoke: async () => [],
			},
			plainHasher,
			() => START,
			randomTokenSource,
		);
		await service.createOperator(usernameOf("boss"), PASSWORD, SYSTEM_ID);
		expect(recorded).toMatchObject({
			username: "boss",
			role: "operator",
			createdBy: SYSTEM_ID,
		});
	});

	it("refuses a name that is taken", async () => {
		const { service } = world();
		await service.createOperator(usernameOf("boss"), PASSWORD, SYSTEM_ID);
		const taken = await service.createOperator(
			usernameOf("boss"),
			PASSWORD,
			SYSTEM_ID,
		);
		expect(taken.isErr() && taken.error).toBe("username_taken");
	});
});
