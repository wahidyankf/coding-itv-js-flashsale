// The accounts and logins use case: sign-up, login, refresh, logout, who a request is from, and the operator check. The
// rules (password length, token lifetimes, who may manage sales) are in the domain. The stores, the hasher, the clock
// and the token source are ports, so this service names no database.

import { MS_PER_SECOND } from "@flash/flash-commons";
import { Err, Ok, type Result } from "@flash/typekit";
import {
	ACCESS_TTL_SECONDS,
	hashToken,
	isOperator,
	type Principal,
	REFRESH_TTL_SECONDS,
	type Role,
	usablePassword,
} from "../domain/auth.js";
import { isLive } from "../domain/time.js";
import { normalizeUser, type UserId } from "../domain/user.js";
import type { AccountStore } from "./ports/account-store.js";
import type { Clock } from "./ports/clock.js";
import type { PasswordHasher } from "./ports/password-hasher.js";
import type { ClientInfo, SessionStore } from "./ports/session-store.js";
import type { TokenSource } from "./ports/token-source.js";

// What a login hands to the client: who it is, and the two tokens with the time each one ends.
export type Login = {
	principal: Principal;
	accessToken: string;
	accessExpiresAt: Date;
	refreshToken: string;
	refreshExpiresAt: Date;
};

// Why an account cannot be made: the name is not usable, the password is not, or the name is taken.
export type RegisterError =
	| "invalid_user"
	| "invalid_password"
	| "username_taken";

export type AuthService = {
	// Makes a shopper account and logs it in.
	register: (
		username: unknown,
		password: unknown,
		client?: ClientInfo,
	) => Promise<Result<Login, RegisterError>>;
	// One error for an unknown name and a wrong password, so a reply never says which names exist.
	login: (
		username: unknown,
		password: unknown,
		client?: ClientInfo,
	) => Promise<Result<Login, "invalid_credentials">>;
	// Trades the refresh token for a new pair. The old refresh token stops working.
	refresh: (
		refreshToken: string | undefined,
	) => Promise<Result<Login, "invalid_refresh_token">>;
	// Ends the login of these tokens, whichever of them the client still has.
	logout: (tokens: {
		accessToken?: string | undefined;
		refreshToken?: string | undefined;
	}) => Promise<void>;
	// Who the access token belongs to, if its login is still open.
	authenticate: (
		accessToken: string | undefined,
	) => Promise<Result<Principal, "not_authenticated">>;
	// Who may manage sales: the logged-in operator. A shopper who is logged in is `forbidden`, not unknown.
	authorizeOperator: (
		accessToken: string | undefined,
	) => Promise<Result<Principal, "not_authenticated" | "forbidden">>;
	// Makes an operator account, for the command that makes the first one. `createdBy` is the system user.
	createOperator: (
		username: unknown,
		password: unknown,
		createdBy: UserId,
	) => Promise<Result<Principal, RegisterError>>;
};

// The ports the steps below work with. They are passed as one value, so each step keeps a short parameter list.
type AuthPorts = {
	accounts: AccountStore;
	sessions: SessionStore;
	hasher: PasswordHasher;
	clock: Clock;
	tokens: TokenSource;
};

// Two fresh tokens and the times they end. The clock is read once, so both times count from the same moment.
function issuePair(ports: AuthPorts) {
	const now = ports.clock().getTime();
	return {
		accessToken: ports.tokens(),
		refreshToken: ports.tokens(),
		accessExpiresAt: new Date(now + ACCESS_TTL_SECONDS * MS_PER_SECOND),
		refreshExpiresAt: new Date(now + REFRESH_TTL_SECONDS * MS_PER_SECOND),
	};
}

// Records a new login and returns the tokens to hand out. Only their hashes are stored.
async function openLogin(
	ports: AuthPorts,
	principal: Principal,
	client: ClientInfo = {},
): Promise<Login> {
	const issued = issuePair(ports);
	await ports.sessions.create({
		userId: principal.userId,
		accessHash: hashToken(issued.accessToken),
		accessExpiresAt: issued.accessExpiresAt,
		refreshHash: hashToken(issued.refreshToken),
		refreshExpiresAt: issued.refreshExpiresAt,
		ip: client.ip,
		userAgent: client.userAgent,
	});
	return { principal, ...issued };
}

// A new account with a role, after the name and the password have passed the rules.
async function makeAccount(
	ports: AuthPorts,
	rawUsername: unknown,
	rawPassword: unknown,
	role: Role,
	createdBy?: UserId,
): Promise<Result<Principal, RegisterError>> {
	const username = normalizeUser(rawUsername);
	if (username === undefined) return new Err("invalid_user");
	const password = usablePassword(rawPassword);
	if (password === undefined) return new Err("invalid_password");
	const created = await ports.accounts.register({
		username,
		passwordHash: await ports.hasher.hash(password),
		role,
		createdBy,
	});
	return created.isErr() ? new Err(created.error) : new Ok(created.value);
}

// Who an access token belongs to, if its login is still open.
async function authenticateWith(
	ports: AuthPorts,
	accessToken: string | undefined,
): Promise<Result<Principal, "not_authenticated">> {
	if (accessToken === undefined) return new Err("not_authenticated");
	const now = ports.clock();
	const found = await ports.sessions.findByAccess(hashToken(accessToken), now);
	// A cache may hold the answer, so the end time is checked here as well.
	if (found === undefined || !isLive(found, now)) {
		return new Err("not_authenticated");
	}
	return new Ok(found.principal);
}

export function createAuthService(
	accounts: AccountStore,
	sessions: SessionStore,
	hasher: PasswordHasher,
	clock: Clock,
	tokens: TokenSource,
): AuthService {
	const ports: AuthPorts = { accounts, sessions, hasher, clock, tokens };
	// A hash to check against when the name is unknown, so that case takes as long as a wrong password.
	const decoy = hasher.hash(tokens());

	return {
		register: async (username, password, client) => {
			const made = await makeAccount(ports, username, password, "shopper");
			return made.isErr()
				? new Err(made.error)
				: new Ok(await openLogin(ports, made.value, client));
		},

		createOperator: (username, password, createdBy) =>
			makeAccount(ports, username, password, "operator", createdBy),

		login: async (rawUsername, rawPassword, client) => {
			const username = normalizeUser(rawUsername);
			const found =
				username === undefined
					? undefined
					: await accounts.findCredentials(username);
			const password = typeof rawPassword === "string" ? rawPassword : "";
			const matches = await hasher.verify(
				password,
				found?.passwordHash ?? (await decoy),
			);
			if (found === undefined || !matches) {
				return new Err("invalid_credentials");
			}
			return new Ok(await openLogin(ports, found.principal, client));
		},

		refresh: async (refreshToken) => {
			if (refreshToken === undefined) return new Err("invalid_refresh_token");
			const issued = issuePair(ports);
			const { principal } = await sessions.rotate({
				presentedRefreshHash: hashToken(refreshToken),
				accessHash: hashToken(issued.accessToken),
				accessExpiresAt: issued.accessExpiresAt,
				refreshHash: hashToken(issued.refreshToken),
				refreshExpiresAt: issued.refreshExpiresAt,
				now: clock(),
			});
			if (principal === undefined) return new Err("invalid_refresh_token");
			return new Ok({ principal, ...issued });
		},

		logout: async ({ accessToken, refreshToken }) => {
			await sessions.revoke({
				accessHash:
					accessToken === undefined ? undefined : hashToken(accessToken),
				refreshHash:
					refreshToken === undefined ? undefined : hashToken(refreshToken),
			});
		},

		authenticate: (accessToken) => authenticateWith(ports, accessToken),

		authorizeOperator: async (accessToken) => {
			const who = await authenticateWith(ports, accessToken);
			if (who.isErr()) return new Err(who.error);
			return isOperator(who.value) ? new Ok(who.value) : new Err("forbidden");
		},
	};
}
