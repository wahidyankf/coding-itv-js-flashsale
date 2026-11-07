// The auth routes: sign-up, login, refresh, logout, and who the access cookie belongs to. A login sets the two cookies and
// the refusal of a refresh clears them. How a cookie is written is in ../cookies.ts. Inbound HTTP adapter.

import { HTTP_STATUS } from "@flash/flash-commons";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Login } from "../../../../application/auth-service.js";
import type { Dependencies } from "../../../../application/dependencies.js";
import {
	ACCESS_TTL_SECONDS,
	type Principal,
	REFRESH_TTL_SECONDS,
} from "../../../../domain/auth.js";
import {
	ACCESS_COOKIE,
	cookieValue,
	cutUserAgent,
	REFRESH_COOKIE,
	REFRESH_COOKIE_PATH,
	setCookie,
} from "../cookies.js";
import { fieldOf } from "./bodies.js";
import { createGuards, principalOf } from "./guards.js";
import { sendError, sendResult } from "./reply.js";

// What the client sees of a login: who it is and its role. The tokens go only in the cookies.
const accountView = (principal: Principal) => ({
	username: principal.username,
	role: principal.role,
});

// What the server knows of the client, for the record of a login. The user agent is client text, so it is cut.
const clientOf = (request: Pick<FastifyRequest, "headers" | "ip">) => ({
	ip: request.ip,
	userAgent: cutUserAgent(request.headers["user-agent"]),
});

// The cookies of a session, written with the `secure` flag the configuration gives. `loginCookies` sets the access and
// refresh pair with their lifetimes; `clearedCookies` sends the same names with a lifetime of zero, which the browser
// drops.
function cookieJarOf(secure: boolean) {
	const pair = (
		access: string,
		refresh: string,
		ages: { access: number; refresh: number },
	) => [
		setCookie(ACCESS_COOKIE, access, {
			maxAgeSeconds: ages.access,
			path: "/",
			secure,
		}),
		setCookie(REFRESH_COOKIE, refresh, {
			maxAgeSeconds: ages.refresh,
			path: REFRESH_COOKIE_PATH,
			secure,
		}),
	];
	return {
		loginCookies: (login: Login) =>
			pair(login.accessToken, login.refreshToken, {
				access: ACCESS_TTL_SECONDS,
				refresh: REFRESH_TTL_SECONDS,
			}),
		clearedCookies: () => pair("", "", { access: 0, refresh: 0 }),
	};
}

// Registers the auth routes. `cookies.secure` says whether the cookies may only travel over HTTPS.
export function registerAuthRoutes(
	app: FastifyInstance,
	deps: Dependencies,
	cookies: { secure: boolean },
): void {
	const { needSession, limitAuth } = createGuards(deps);
	const { loginCookies, clearedCookies } = cookieJarOf(cookies.secure);

	// Signing up makes a shopper account and logs it in. The cookies are the only place the tokens are sent.
	app.route({
		method: "POST",
		url: "/auth/register",
		onRequest: limitAuth,
		handler: async (request, reply) =>
			sendResult(
				reply,
				await deps.auth.register(
					fieldOf(request.body, "username"),
					fieldOf(request.body, "password"),
					clientOf(request),
				),
				(login) =>
					reply
						.header("set-cookie", loginCookies(login))
						.code(HTTP_STATUS.created)
						.send(accountView(login.principal)),
			),
	});

	app.route({
		method: "POST",
		url: "/auth/login",
		onRequest: limitAuth,
		handler: async (request, reply) =>
			sendResult(
				reply,
				await deps.auth.login(
					fieldOf(request.body, "username"),
					fieldOf(request.body, "password"),
					clientOf(request),
				),
				(login) =>
					reply
						.header("set-cookie", loginCookies(login))
						.code(HTTP_STATUS.ok)
						.send(accountView(login.principal)),
			),
	});

	// Trades the refresh token (sent only to /auth) for a new pair. The old refresh token stops working.
	app.route({
		method: "POST",
		url: "/auth/refresh",
		onRequest: limitAuth,
		handler: async (request, reply) => {
			const refreshed = await deps.auth.refresh(
				cookieValue(request.headers.cookie, REFRESH_COOKIE),
			);
			// A refused refresh also clears the cookies, so the browser stops sending the dead ones.
			if (refreshed.isErr()) {
				return sendError(
					reply.header("set-cookie", clearedCookies()),
					refreshed.error,
				);
			}
			return reply
				.header("set-cookie", loginCookies(refreshed.value))
				.code(HTTP_STATUS.ok)
				.send(accountView(refreshed.value.principal));
		},
	});

	// Ends the login. It is safe to send twice, and with no login at all.
	app.route({
		method: "POST",
		url: "/auth/logout",
		onRequest: limitAuth,
		handler: async (request, reply) => {
			await deps.auth.logout({
				accessToken: cookieValue(request.headers.cookie, ACCESS_COOKIE),
				refreshToken: cookieValue(request.headers.cookie, REFRESH_COOKIE),
			});
			return reply
				.header("set-cookie", clearedCookies())
				.code(HTTP_STATUS.ok)
				.send({});
		},
	});

	// Who the cookie says you are.
	app.route({
		method: "GET",
		url: "/auth/me",
		preValidation: needSession,
		handler: async (request, reply) =>
			reply.code(HTTP_STATUS.ok).send(accountView(principalOf(request))),
	});
}
