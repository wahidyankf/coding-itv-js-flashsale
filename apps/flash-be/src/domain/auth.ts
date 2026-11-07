// Logins as the rules see them: who a request is from, how long a login lasts, and what a password must be. The
// cookies that carry a login are the HTTP adapter's concern, and the random tokens come from a TokenSource port; this
// file only hashes a token and says what a value means.
import { createHash } from "node:crypto";
import type { UserId, Username } from "./user.js";

// Who a login may act as. Only an operator may manage sales; a shopper may queue, hold and buy.
export type Role = "shopper" | "operator";

// Who is making a request: the user row, the name the shopper typed, and what they may do.
export type Principal = { userId: UserId; username: Username; role: Role };

// Only an operator may manage sales. A shopper who is logged in is still a shopper.
export function isOperator(principal: Principal): boolean {
	return principal.role === "operator";
}

const SECONDS_PER_MINUTE = 60;
const SECONDS_PER_DAY = 86_400;
// Short, because it goes with every request and a copy of it is worth little for long.
const ACCESS_TTL_MINUTES = 15;
// A week without a visit ends the login; every use of the refresh token starts a new week.
const REFRESH_TTL_DAYS = 7;

// How long an access token lasts, in seconds. It is short on purpose, so a stolen access token is useful for little time.
export const ACCESS_TTL_SECONDS = ACCESS_TTL_MINUTES * SECONDS_PER_MINUTE;
// How long a refresh token lasts, in seconds, counted from its last use. Each refresh is used once, then replaced.
export const REFRESH_TTL_SECONDS = REFRESH_TTL_DAYS * SECONDS_PER_DAY;

// The shortest password the rules accept. Length is the only rule; the edge checks that the body is text first.
export const PASSWORD_MIN_LENGTH = 8;
// The longest password the rules accept. The HTTP and CLI edges refuse a longer one before the service hashes anything.
export const PASSWORD_MAX_LENGTH = 128;

// A password is any text of a usable length. The rules stay short on purpose; a long phrase beats a pattern. The edge
// checks that the body holds text first, so this rule only reads the length.
export function usablePassword(raw: string): string | undefined {
	return raw.length >= PASSWORD_MIN_LENGTH && raw.length <= PASSWORD_MAX_LENGTH
		? raw
		: undefined;
}

// The database keeps only this hash of a token, so a copy of the table cannot be used to log in.
export function hashToken(token: string): string {
	return createHash("sha256").update(token).digest("hex");
}
