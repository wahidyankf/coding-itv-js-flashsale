// Accounts and logins in memory, for the unit layer. The rules are the ones the Postgres adapters keep, and the
// integration layer proves them against the same scenarios. The memory copies store what the Postgres rows would.
import { randomUUID } from "node:crypto";
import { Err, Ok } from "@flash/typekit";
import { ACCESS_COOKIE } from "../../adapters/inbound/http/cookies.js";
import { randomTokenSource } from "../../adapters/outbound/crypto/token-source.js";
import {
	type AuthService,
	createAuthService,
} from "../../application/auth-service.js";
import type { AccountRepository } from "../../application/ports/account-repository.js";
import type { Clock } from "../../application/ports/clock.js";
import type { PasswordHasher } from "../../application/ports/password-hasher.js";
import type { SessionRepository } from "../../application/ports/session-repository.js";
import { hashToken, type Principal, type Role } from "../../domain/auth.js";
import { type UserId, type Username, userIdOf } from "../../domain/user.js";
import type { UserRow } from "./auth-world.js";
import { usernameOf } from "./users.js";

// A password check that costs nothing, so a scenario with many shoppers is not slowed down by hashing.
export const plainHasher: PasswordHasher = {
	hash: async (password) => `plain$${password}`,
	verify: async (password, stored) => stored === `plain$${password}`,
};

// The password every scenario's logins use. The memory login helper sets it, and then logs in with it.
const SCENARIO_PASSWORD = "a long password";

// One account: its principal, the hash of its password, and the audit fields its Postgres row would hold.
type Account = {
	principal: Principal;
	passwordHash: string;
	lastLoginAt: Date | undefined;
	updatedAt: Date | undefined;
	updatedBy: UserId | undefined;
};

// One login: the hashes of its tokens, when they end, and whether it was ended.
type Row = {
	userId: UserId;
	accessHash: string;
	accessExpiresAt: Date;
	refreshHash: string;
	refreshExpiresAt: Date;
	previousRefreshHash: string | undefined;
	deleted: boolean;
};

// The in-memory login of the unit layer: the auth service, the logins and what the stores hold, so a scenario checks
// the hashes without Postgres.
export type MemoryAuth = {
	service: AuthService;
	// A cookie header for a user who is logged in, made on first use. `role` matters only the first time.
	login: (username: string, role?: Role) => Promise<string>;
	// What the stores hold: the password hashes, and the hashes of the tokens of every login.
	stored: () => { passwordHashes: string[]; tokenHashes: string[] };
	// The id of a user who has an account, if there is one.
	idOf: (username: string) => string | undefined;
	// The audit fields of the account's row, as Postgres would hold them.
	userRow: (username: string) => UserRow | undefined;
	// The auth service of another instance: its own service object over the same accounts and logins, as a second server
	// over the same Postgres is.
	anotherInstance: () => AuthService;
	// Whether the login of this access token is still open: its row is not marked deleted.
	liveSession: (accessToken: string) => boolean;
};

// Accounts by name: a name is taken once, and a principal is found by name.
function memoryAccounts(users: Map<Username, Account>): AccountRepository {
	return {
		register: async (account) => {
			if (users.has(account.username)) {
				return new Err("username_taken" as const);
			}
			const principal: Principal = {
				userId: userIdOf(randomUUID()),
				username: account.username,
				role: account.role,
			};
			users.set(account.username, {
				principal,
				passwordHash: account.passwordHash,
				lastLoginAt: undefined,
				updatedAt: undefined,
				updatedBy: undefined,
			});
			return new Ok(principal);
		},
		findCredentials: async (username) => {
			const found = users.get(username);
			return found && { ...found };
		},
	};
}

// Logins: one row per login, holding only the hashes of its tokens. A refresh token used twice ends its login. `stamp`
// records the login on the user's row, as the Postgres adapter does in the same transaction.
function memorySessions(
	rows: Row[],
	principalById: (userId: UserId) => Principal | undefined,
	stamp: (userId: UserId) => void,
): SessionRepository {
	const liveRows = (predicate: (row: Row) => boolean) =>
		rows.filter((row) => !row.deleted && predicate(row));
	return {
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
			stamp(session.userId);
		},
		findByAccess: async (accessHash, now) => {
			const row = liveRows(
				(candidate) =>
					candidate.accessHash === accessHash &&
					candidate.accessExpiresAt > now,
			)[0];
			const principal = row && principalById(row.userId);
			return row && principal && { principal, expiresAt: row.accessExpiresAt };
		},
		rotate: async (rotation) => {
			const row = liveRows(
				(candidate) => candidate.refreshHash === rotation.presentedRefreshHash,
			)[0];
			if (row === undefined) {
				const replayed = liveRows(
					(candidate) =>
						candidate.previousRefreshHash === rotation.presentedRefreshHash,
				)[0];
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
			const ended = liveRows(
				(row) =>
					(accessHash !== undefined && row.accessHash === accessHash) ||
					(refreshHash !== undefined &&
						(row.refreshHash === refreshHash ||
							row.previousRefreshHash === refreshHash)),
			);
			for (const row of ended) row.deleted = true;
			return ended.map((row) => row.accessHash);
		},
	};
}

// Accounts and sessions in memory. `sessionClock` is the clock of the logins, apart from any clock a scenario moves.
export function memoryAuth(
	sessionClock: Clock,
	hasher: PasswordHasher = plainHasher,
): MemoryAuth {
	const users = new Map<Username, Account>();
	const rows: Row[] = [];
	const principalById = (userId: UserId): Principal | undefined =>
		[...users.values()].find((user) => user.principal.userId === userId)
			?.principal;
	// A login is the user's own act, so the user is the one who changed the row.
	const stamp = (userId: UserId) => {
		const account = [...users.values()].find(
			(user) => user.principal.userId === userId,
		);
		if (account === undefined) return;
		const at = sessionClock();
		account.lastLoginAt = at;
		account.updatedAt = at;
		account.updatedBy = userId;
	};
	const accounts = memoryAccounts(users);
	const instance = () =>
		createAuthService(
			accounts,
			memorySessions(rows, principalById, stamp),
			hasher,
			sessionClock,
			randomTokenSource,
		);
	const service = instance();
	const cookies = new Map<string, string>();
	return {
		service,
		anotherInstance: instance,
		liveSession: (accessToken) =>
			rows.some(
				(row) => !row.deleted && row.accessHash === hashToken(accessToken),
			),
		stored: () => ({
			passwordHashes: [...users.values()].map((user) => user.passwordHash),
			tokenHashes: rows.flatMap((row) => [row.accessHash, row.refreshHash]),
		}),
		idOf: (username) => users.get(usernameOf(username))?.principal.userId,
		userRow: (username) => {
			const found = users.get(usernameOf(username));
			return (
				found && {
					id: found.principal.userId,
					lastLoginAt: found.lastLoginAt,
					updatedAt: found.updatedAt,
					updatedBy: found.updatedBy,
				}
			);
		},
		login: async (username, role = "shopper") => {
			const known = cookies.get(username);
			if (known !== undefined) return known;
			const name = usernameOf(username);
			const registered = await accounts.register({
				username: name,
				passwordHash: await hasher.hash(SCENARIO_PASSWORD),
				role,
			});
			if (registered.isErr()) throw new Error(`${username} already exists`);
			const login = await service.login(name, SCENARIO_PASSWORD);
			if (login.isErr()) throw new Error("the login failed");
			const cookie = `${ACCESS_COOKIE}=${login.value.accessToken}`;
			cookies.set(username, cookie);
			return cookie;
		},
	};
}
