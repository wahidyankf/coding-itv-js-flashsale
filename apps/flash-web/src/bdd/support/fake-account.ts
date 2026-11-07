// The fake flash-be's account routes: sign up, log in, trade the refresh token, log out, and who am I. Sessions and cookies
// are kept here the way flash-be keeps them: two cookies per login, and a refresh token that works only once. Test
// support only.

import { MS_PER_SECOND } from "../../api";
import { cleanPassword, cleanUser } from "../../auth/messages";
import { type Reply, refuse, reply } from "./fake-http";
import type { FakeState, Session } from "./fake-state";

// The names and the lives of the two cookies, as flash-be sets them.
export const ACCESS_COOKIE = "access_token";
// The name of the refresh cookie, which flash-be sets for /auth only.
export const REFRESH_COOKIE = "refresh_token";
const ACCESS_TTL_MS = 15 * 60 * MS_PER_SECOND;
const REFRESH_TTL_MS = 7 * 24 * 60 * 60 * MS_PER_SECOND;

const cookie = (name: string, value: string, path: string, maxAgeMs: number) =>
	`${name}=${value}; Path=${path}; Max-Age=${Math.floor(maxAgeMs / MS_PER_SECOND)}; HttpOnly; SameSite=Lax`;
const cookiesOf = (session: Session) => [
	cookie(ACCESS_COOKIE, session.access, "/", ACCESS_TTL_MS),
	cookie(REFRESH_COOKIE, session.refresh, "/auth", REFRESH_TTL_MS),
];
const clearedCookies = () => [
	cookie(ACCESS_COOKIE, "", "/", 0),
	cookie(REFRESH_COOKIE, "", "/auth", 0),
];
const cookieValue = (header: string | undefined, name: string) =>
	(header ?? "")
		.split(";")
		.map((part) => part.trim().split("="))
		.find(([key]) => key === name)?.[1];

function startSession(state: FakeState, user: string): Session {
	const session: Session = {
		user,
		access: crypto.randomUUID(),
		accessEndsAt: state.now() + ACCESS_TTL_MS,
		refresh: crypto.randomUUID(),
		refreshEndsAt: state.now() + REFRESH_TTL_MS,
		previous: undefined,
	};
	state.sessions.push(session);
	return session;
}

// The name of the shopper whose access cookie is in the header, if that cookie still works.
export function userOf(
	state: FakeState,
	cookies: string | undefined,
): string | undefined {
	const token = cookieValue(cookies, ACCESS_COOKIE);
	return state.sessions.find(
		(session) => session.access === token && session.accessEndsAt > state.now(),
	)?.user;
}

const account = (user: string) => ({ username: user, role: "shopper" });

// Signs a shopper up: makes the account and starts a login, unless the name is taken or the input is refused.
export function register(
	state: FakeState,
	body: Record<string, unknown>,
): Reply {
	const user = cleanUser(String(body.username ?? ""));
	if (user === undefined) return refuse("invalid_user");
	const password = cleanPassword(String(body.password ?? ""));
	if (password === undefined) return refuse("invalid_password");
	if (state.accounts.has(user)) return refuse("username_taken");
	state.accounts.set(user, { password, role: "shopper" });
	return reply(201, account(user), {}, cookiesOf(startSession(state, user)));
}

// Logs a shopper in when the name and the password match an account.
export function login(state: FakeState, body: Record<string, unknown>): Reply {
	const user = cleanUser(String(body.username ?? ""));
	const known = user === undefined ? undefined : state.accounts.get(user);
	if (user === undefined || known?.password !== body.password) {
		return refuse("invalid_credentials");
	}
	return reply(200, account(user), {}, cookiesOf(startSession(state, user)));
}

// Trades the refresh token for a new pair. The old one works no more. Showing it again ends the login, as flash-be does.
export function refresh(state: FakeState, cookies: string | undefined): Reply {
	const token = cookieValue(cookies, REFRESH_COOKIE);
	const session = state.sessions.find(
		(candidate) => token !== undefined && candidate.refresh === token,
	);
	const replayed = state.sessions.find(
		(candidate) => token !== undefined && candidate.previous === token,
	);
	if (replayed) state.sessions.splice(state.sessions.indexOf(replayed), 1);
	if (!session || session.refreshEndsAt <= state.now()) {
		return { ...refuse("invalid_refresh_token"), cookies: clearedCookies() };
	}
	session.previous = session.refresh;
	session.refresh = crypto.randomUUID();
	session.access = crypto.randomUUID();
	session.accessEndsAt = state.now() + ACCESS_TTL_MS;
	session.refreshEndsAt = state.now() + REFRESH_TTL_MS;
	return reply(200, account(session.user), {}, cookiesOf(session));
}

// Ends the sessions that the cookies name, and clears the cookies whatever they name.
export function logout(state: FakeState, cookies: string | undefined): Reply {
	const access = cookieValue(cookies, ACCESS_COOKIE);
	const token = cookieValue(cookies, REFRESH_COOKIE);
	for (const session of state.sessions.filter(
		(candidate) => candidate.access === access || candidate.refresh === token,
	)) {
		state.sessions.splice(state.sessions.indexOf(session), 1);
	}
	return reply(200, {}, {}, clearedCookies());
}

// The account of the shopper whose cookie is sent, or a refusal when no login works.
export function whoAmI(state: FakeState, cookies: string | undefined): Reply {
	const user = userOf(state, cookies);
	return user === undefined
		? refuse("not_authenticated")
		: reply(200, account(user));
}

// Scenario setup: an account that already exists, made without the page.
export function addAccount(state: FakeState, user: string, password: string) {
	state.accounts.set(user, { password, role: "shopper" });
}

// A moment one millisecond ago, which is already past: a token that expires there has expired.
const alreadyExpired = (state: FakeState) => state.now() - 1;

// Scenario setup: every login ends, as the passing of 7 days does.
export function endLogins(state: FakeState) {
	for (const session of state.sessions) {
		session.accessEndsAt = alreadyExpired(state);
		session.refreshEndsAt = alreadyExpired(state);
	}
}

// Scenario setup: only the short token ends, as the passing of 15 minutes does. The refresh token still works.
export function endAccessTokens(state: FakeState) {
	for (const session of state.sessions) {
		session.accessEndsAt = alreadyExpired(state);
	}
}
