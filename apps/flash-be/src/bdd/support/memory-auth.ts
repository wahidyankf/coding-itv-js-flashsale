import { randomUUID } from "node:crypto";
import { Err, Ok } from "@flash/typekit";
import {
	type AuthService,
	createAuthService,
} from "../../application/auth-service.js";
import type { AccountStore } from "../../application/ports/account-store.js";
import type { Clock } from "../../application/ports/clock.js";
import type { PasswordHasher } from "../../application/ports/password-hasher.js";
import type { SessionStore } from "../../application/ports/session-store.js";
import { ACCESS_COOKIE, type Principal, type Role } from "../../domain/auth.js";

// A password check that costs nothing, so a scenario with many shoppers is not slowed down by hashing.
export const plainHasher: PasswordHasher = {
	hash: async (password) => `plain$${password}`,
	verify: async (password, stored) => stored === `plain$${password}`,
};

type Row = {
	userId: string;
	accessHash: string;
	accessExpiresAt: Date;
	refreshHash: string;
	refreshExpiresAt: Date;
	previousRefreshHash: string | undefined;
	deleted: boolean;
};

export type MemoryAuth = {
	service: AuthService;
	// A cookie header for a user who is logged in, made on first use. `role` matters only the first time.
	login: (username: string, role?: Role) => Promise<string>;
	// What the stores hold: the password hashes, and the hashes of the tokens of every login.
	stored: () => { passwordHashes: string[]; tokenHashes: string[] };
	// The id of a user who has an account, if there is one.
	idOf: (username: string) => string | undefined;
};

// Accounts and sessions in memory, with the same rules as the Postgres adapters (they are proved against it in the
// integration layer). `sessionClock` is the clock of the logins, apart from any clock a scenario moves.
export function memoryAuth(
	sessionClock: Clock,
	hasher: PasswordHasher = plainHasher,
): MemoryAuth {
	const users = new Map<
		string,
		{ principal: Principal; passwordHash: string }
	>();
	const rows: Row[] = [];
	const principalById = (userId: string): Principal | undefined =>
		[...users.values()].find((user) => user.principal.userId === userId)
			?.principal;

	const accounts: AccountStore = {
		register: async (account) => {
			if (users.has(account.username)) {
				return new Err("username_taken" as const);
			}
			const principal: Principal = {
				userId: randomUUID(),
				username: account.username,
				role: account.role,
			};
			users.set(account.username, {
				principal,
				passwordHash: account.passwordHash,
			});
			return new Ok(principal);
		},
		findCredentials: async (username) => {
			const found = users.get(username);
			return found && { ...found };
		},
	};

	const sessions: SessionStore = {
		create: async (session) => {
			rows.push({
				userId: session.userId,
				accessHash: session.accessHash,
				accessExpiresAt: session.accessExpiresAt,
				refreshHash: session.refreshHash,
				refreshExpiresAt: session.refreshExpiresAt,
				previousRefreshHash: undefined,
				deleted: false,
			});
		},
		findByAccess: async (accessHash, now) => {
			const row = rows.find(
				(candidate) =>
					!candidate.deleted &&
					candidate.accessHash === accessHash &&
					candidate.accessExpiresAt > now,
			);
			const principal = row && principalById(row.userId);
			return row && principal && { principal, expiresAt: row.accessExpiresAt };
		},
		rotate: async (rotation) => {
			const row = rows.find(
				(candidate) =>
					!candidate.deleted &&
					candidate.refreshHash === rotation.presentedRefreshHash,
			);
			if (row === undefined) {
				const replayed = rows.find(
					(candidate) =>
						!candidate.deleted &&
						candidate.previousRefreshHash === rotation.presentedRefreshHash,
				);
				if (replayed) replayed.deleted = true;
				return {
					principal: undefined,
					ended: replayed ? [replayed.accessHash] : [],
				};
			}
			if (row.refreshExpiresAt <= rotation.now) {
				return { principal: undefined, ended: [] };
			}
			const endedAccessHash = row.accessHash;
			row.previousRefreshHash = rotation.presentedRefreshHash;
			row.accessHash = rotation.accessHash;
			row.accessExpiresAt = rotation.accessExpiresAt;
			row.refreshHash = rotation.refreshHash;
			row.refreshExpiresAt = rotation.refreshExpiresAt;
			return {
				principal: principalById(row.userId),
				ended: [endedAccessHash],
			};
		},
		revoke: async ({ accessHash, refreshHash }) => {
			const ended = rows.filter(
				(row) =>
					!row.deleted &&
					((accessHash !== undefined && row.accessHash === accessHash) ||
						(refreshHash !== undefined &&
							(row.refreshHash === refreshHash ||
								row.previousRefreshHash === refreshHash))),
			);
			for (const row of ended) row.deleted = true;
			return ended.map((row) => row.accessHash);
		},
	};

	const service = createAuthService(accounts, sessions, hasher, sessionClock);
	const cookies = new Map<string, string>();
	return {
		service,
		stored: () => ({
			passwordHashes: [...users.values()].map((user) => user.passwordHash),
			tokenHashes: rows.flatMap((row) => [row.accessHash, row.refreshHash]),
		}),
		idOf: (username) => users.get(username)?.principal.userId,
		login: async (username, role = "shopper") => {
			const known = cookies.get(username);
			if (known !== undefined) return known;
			const registered = await accounts.register({
				username,
				passwordHash: await hasher.hash("a long password"),
				role,
			});
			if (registered.isErr()) throw new Error(`${username} already exists`);
			const login = await service.login(username, "a long password");
			if (login.isErr()) throw new Error("the login failed");
			const cookie = `${ACCESS_COOKIE}=${login.value.accessToken}`;
			cookies.set(username, cookie);
			return cookie;
		},
	};
}
