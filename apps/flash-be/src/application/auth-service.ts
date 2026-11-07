import { Err, Ok, type Result } from "@flash/typekit";
import {
	ACCESS_TTL_SECONDS,
	hashToken,
	newToken,
	type Principal,
	REFRESH_TTL_SECONDS,
	usablePassword,
} from "../domain/auth.js";
import { MS_PER_SECOND } from "../domain/time.js";
import { normalizeUser } from "../domain/user.js";
import type { AccountStore } from "./ports/account-store.js";
import type { Clock } from "./ports/clock.js";
import type { PasswordHasher } from "./ports/password-hasher.js";
import type { ClientInfo, SessionStore } from "./ports/session-store.js";

// What a login hands to the client: who it is, and the two tokens with the time each one ends.
export type Login = {
	principal: Principal;
	accessToken: string;
	accessExpiresAt: Date;
	refreshToken: string;
	refreshExpiresAt: Date;
};

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
	authenticate: (
		accessToken: string | undefined,
	) => Promise<Result<Principal, "not_authenticated">>;
};

export function createAuthService(
	accounts: AccountStore,
	sessions: SessionStore,
	hasher: PasswordHasher,
	clock: Clock,
): AuthService {
	// A hash to check against when the name is unknown, so that case takes as long as a wrong password.
	const decoy = hasher.hash(newToken());

	const pair = () => {
		const now = clock().getTime();
		return {
			accessToken: newToken(),
			refreshToken: newToken(),
			accessExpiresAt: new Date(now + ACCESS_TTL_SECONDS * MS_PER_SECOND),
			refreshExpiresAt: new Date(now + REFRESH_TTL_SECONDS * MS_PER_SECOND),
		};
	};

	const open = async (
		principal: Principal,
		client: ClientInfo = {},
	): Promise<Login> => {
		const tokens = pair();
		await sessions.create({
			userId: principal.userId,
			accessHash: hashToken(tokens.accessToken),
			accessExpiresAt: tokens.accessExpiresAt,
			refreshHash: hashToken(tokens.refreshToken),
			refreshExpiresAt: tokens.refreshExpiresAt,
			ip: client.ip,
			userAgent: client.userAgent,
		});
		return { principal, ...tokens };
	};

	return {
		register: async (rawUsername, rawPassword, client) => {
			const username = normalizeUser(rawUsername);
			if (username === undefined) return new Err("invalid_user");
			const password = usablePassword(rawPassword);
			if (password === undefined) return new Err("invalid_password");
			const created = await accounts.register({
				username,
				passwordHash: await hasher.hash(password),
				role: "shopper",
			});
			if (created.isErr()) return new Err(created.error);
			return new Ok(await open(created.value, client));
		},

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
			return new Ok(await open(found.principal, client));
		},

		refresh: async (refreshToken) => {
			if (refreshToken === undefined) return new Err("invalid_refresh_token");
			const tokens = pair();
			const { principal } = await sessions.rotate({
				presentedRefreshHash: hashToken(refreshToken),
				accessHash: hashToken(tokens.accessToken),
				accessExpiresAt: tokens.accessExpiresAt,
				refreshHash: hashToken(tokens.refreshToken),
				refreshExpiresAt: tokens.refreshExpiresAt,
				now: clock(),
			});
			if (principal === undefined) return new Err("invalid_refresh_token");
			return new Ok({ principal, ...tokens });
		},

		logout: async ({ accessToken, refreshToken }) => {
			await sessions.revoke({
				accessHash:
					accessToken === undefined ? undefined : hashToken(accessToken),
				refreshHash:
					refreshToken === undefined ? undefined : hashToken(refreshToken),
			});
		},

		authenticate: async (accessToken) => {
			if (accessToken === undefined) return new Err("not_authenticated");
			const now = clock();
			const found = await sessions.findByAccess(hashToken(accessToken), now);
			// A cache may hold the answer, so the end time is checked here as well.
			return found === undefined || found.expiresAt <= now
				? new Err("not_authenticated")
				: new Ok(found.principal);
		},
	};
}
