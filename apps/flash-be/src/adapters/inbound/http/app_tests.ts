import { Err, Ok } from "@flash/typekit";
import { afterEach, describe, expect, it } from "vitest";
import type { Dependencies } from "../../../application/dependencies.js";
import { healthyDeps } from "../../../bdd/support/deps.js";
import { isOperator, type Principal } from "../../../domain/auth.js";
import { buildApp } from "./app.js";
import { errorPayload } from "./errors.js";

const apps: Array<ReturnType<typeof buildApp>> = [];
afterEach(async () => {
	await Promise.all(apps.splice(0).map((app) => app.close()));
});

function appWith(
	deps: Dependencies = healthyDeps,
	options: Parameters<typeof buildApp>[1] = {},
) {
	const app = buildApp(deps, options);
	apps.push(app);
	return app;
}

const json = { "content-type": "application/json" };
const MISSING_SALE = "00000000-0000-4000-8000-000000000000";
const PURCHASES = "/sales/00000000-0000-4000-8000-000000000000/purchases";

// Who is logged in, by the value of the access cookie.
const SHOPPER_COOKIE = "access_token=shopper-token";
const OPERATOR_COOKIE = "access_token=operator-token";
const principals: Record<string, Principal> = {
	"shopper-token": { userId: "user-1", username: "ana", role: "shopper" },
	"operator-token": { userId: "user-2", username: "boss", role: "operator" },
};
const auth: Dependencies["auth"] = {
	...healthyDeps.auth,
	authenticate: async (token) => {
		const found = token === undefined ? undefined : principals[token];
		return found ? new Ok(found) : new Err("not_authenticated" as const);
	},
	authorizeOperator: async (token) => {
		const found = token === undefined ? undefined : principals[token];
		if (!found) return new Err("not_authenticated" as const);
		return isOperator(found) ? new Ok(found) : new Err("forbidden" as const);
	},
};
const loggedIn = { ...healthyDeps, auth };

describe("the errors of the HTTP edge", () => {
	it("answers a failure inside the server with `internal` and no detail", async () => {
		const app = appWith({
			...healthyDeps,
			sales: {
				...healthyDeps.sales,
				current: async () => {
					throw new Error("secret detail");
				},
			},
		});
		const reply = await app.inject({ method: "GET", url: "/sales/current" });
		expect(reply.statusCode).toBe(500);
		expect(reply.json()).toEqual(errorPayload("internal"));
	});

	it("refuses a body that is too large as `invalid_request`", async () => {
		const reply = await appWith(loggedIn).inject({
			method: "POST",
			url: PURCHASES,
			headers: { ...json, cookie: SHOPPER_COOKIE },
			payload: JSON.stringify({ reservationId: "a".repeat(2_000_000) }),
		});
		expect(reply.statusCode).toBe(400);
		expect(reply.json()).toEqual(errorPayload("invalid_request"));
	});

	it("refuses an unsupported media type as `invalid_request`", async () => {
		const reply = await appWith(loggedIn).inject({
			method: "POST",
			url: PURCHASES,
			headers: { "content-type": "application/xml", cookie: SHOPPER_COOKIE },
			payload: "ana",
		});
		expect(reply.statusCode).toBe(400);
		expect(reply.json()).toEqual(errorPayload("invalid_request"));
	});

	it("refuses an empty JSON body as `invalid_request`", async () => {
		const reply = await appWith(loggedIn).inject({
			method: "POST",
			url: PURCHASES,
			headers: { ...json, cookie: SHOPPER_COOKIE },
			payload: "",
		});
		expect(reply.statusCode).toBe(400);
		expect(reply.json()).toEqual(errorPayload("invalid_request"));
	});

	it("refuses a body that is null as `invalid_reservation`, like a missing id", async () => {
		const reply = await appWith(loggedIn).inject({
			method: "POST",
			url: PURCHASES,
			headers: { ...json, cookie: SHOPPER_COOKIE },
			payload: "null",
		});
		expect(reply.statusCode).toBe(400);
		expect(reply.json()).toEqual(errorPayload("invalid_reservation"));
	});

	it("does not ask the service when the body is refused", async () => {
		let asked = 0;
		const app = appWith({
			...loggedIn,
			purchases: {
				...healthyDeps.purchases,
				confirm: async (...args) => {
					asked += 1;
					return healthyDeps.purchases.confirm(...args);
				},
			},
		});
		await app.inject({
			method: "POST",
			url: PURCHASES,
			headers: { ...json, cookie: SHOPPER_COOKIE },
			payload: "{}",
		});
		expect(asked).toBe(0);
	});
});

describe("the login of a shopper at the edge", () => {
	it("refuses a request with no login as `not_authenticated`", async () => {
		const reply = await appWith(loggedIn).inject({
			method: "POST",
			url: PURCHASES,
			headers: json,
			payload: JSON.stringify({ reservationId: "r" }),
		});
		expect(reply.statusCode).toBe(401);
		expect(reply.json()).toEqual(errorPayload("not_authenticated"));
	});

	it("counts a try by the name of the shopper who is logged in", async () => {
		const seen: unknown[] = [];
		const app = appWith({
			...loggedIn,
			rateLimiter: {
				...healthyDeps.rateLimiter,
				check: async (request) => {
					seen.push(request.user);
					return { limited: false };
				},
			},
		});
		await app.inject({
			method: "POST",
			url: PURCHASES,
			headers: { ...json, cookie: SHOPPER_COOKIE },
			payload: "{}",
		});
		expect(seen).toEqual(["ana"]);
	});

	it("counts a try with no login by address, and then refuses it", async () => {
		const seen: unknown[] = [];
		const app = appWith({
			...loggedIn,
			rateLimiter: {
				...healthyDeps.rateLimiter,
				check: async (request) => {
					seen.push(request.user);
					return { limited: false };
				},
			},
		});
		const reply = await app.inject({
			method: "POST",
			url: PURCHASES,
			headers: json,
			payload: "{}",
		});
		expect(seen).toEqual([undefined]);
		expect(reply.statusCode).toBe(401);
	});

	it("tells a client over the limit to wait, before it says the login is missing", async () => {
		const app = appWith({
			...loggedIn,
			rateLimiter: {
				...healthyDeps.rateLimiter,
				check: async () => ({ limited: true, retryAfterSeconds: 7 }),
			},
		});
		const reply = await app.inject({
			method: "POST",
			url: PURCHASES,
			headers: json,
			payload: "{}",
		});
		expect(reply.statusCode).toBe(429);
		expect(reply.headers["retry-after"]).toBe("7");
		expect(reply.json()).toEqual({
			...errorPayload("rate_limited"),
			retryAfterSeconds: 7,
		});
	});
});

describe("the auth routes at the edge", () => {
	it("count every try by address with the limit of their own, and tell a client over it to wait", async () => {
		const seen: string[] = [];
		const app = appWith({
			...healthyDeps,
			rateLimiter: {
				...healthyDeps.rateLimiter,
				checkAuth: async (request) => {
					seen.push(request.ip);
					return { limited: true, retryAfterSeconds: 4 };
				},
			},
		});
		for (const url of ["/auth/register", "/auth/login", "/auth/refresh"]) {
			const reply = await app.inject({
				method: "POST",
				url,
				headers: json,
				payload: "{}",
			});
			expect(reply.statusCode).toBe(429);
			expect(reply.headers["retry-after"]).toBe("4");
		}
		expect(seen).toHaveLength(3);
	});
});

describe("the cookies of a login", () => {
	const login = {
		principal: principals["shopper-token"] as Principal,
		accessToken: "a-token",
		accessExpiresAt: new Date("2026-06-01T12:15:00Z"),
		refreshToken: "r-token",
		refreshExpiresAt: new Date("2026-06-08T12:00:00Z"),
	};
	const loginDeps: Dependencies = {
		...healthyDeps,
		auth: { ...healthyDeps.auth, login: async () => new Ok(login) },
	};
	const attempt = (app: ReturnType<typeof appWith>) =>
		app.inject({
			method: "POST",
			url: "/auth/login",
			headers: json,
			payload: JSON.stringify({ username: "ana", password: "a long password" }),
		});

	it("sends the tokens only as HttpOnly cookies, never in the body", async () => {
		const reply = await attempt(appWith(loginDeps));
		expect(reply.statusCode).toBe(200);
		expect(reply.json()).toEqual({ username: "ana", role: "shopper" });
		const cookies = [reply.headers["set-cookie"]].flat().map(String);
		expect(cookies).toHaveLength(2);
		for (const cookie of cookies) {
			expect(cookie).toContain("HttpOnly");
			expect(cookie).toContain("SameSite=Lax");
			expect(cookie).not.toContain("Secure");
		}
		expect(cookies[0]).toContain("access_token=a-token");
		expect(cookies[1]).toContain("refresh_token=r-token");
		expect(cookies[1]).toContain("Path=/auth");
	});

	it("records the address and the cut user agent of the login, and none when the client sends none", async () => {
		const seen: Array<{
			ip?: string | undefined;
			userAgent?: string | undefined;
		}> = [];
		const spyDeps: Dependencies = {
			...healthyDeps,
			auth: {
				...healthyDeps.auth,
				login: async (_username, _password, client) => {
					if (client) seen.push(client);
					return new Ok(login);
				},
			},
		};
		const app = appWith(spyDeps);
		const send = (userAgent: string | undefined) =>
			app.inject({
				method: "POST",
				url: "/auth/login",
				headers: {
					...json,
					...(userAgent === undefined ? {} : { "user-agent": userAgent }),
				},
				payload: JSON.stringify({ username: "ana", password: "x" }),
			});
		await send("a".repeat(500));
		await send(undefined);
		expect(seen[0]?.userAgent).toHaveLength(200);
		expect(seen[0]?.ip).toBeTypeOf("string");
		expect(seen[1]?.userAgent).toBe("lightMyRequest");
	});

	it("adds Secure when the cookies are for HTTPS only", async () => {
		const reply = await attempt(appWith(loginDeps, { cookieSecure: true }));
		for (const cookie of [reply.headers["set-cookie"]].flat().map(String)) {
			expect(cookie).toContain("Secure");
		}
	});
});

describe("the admin route at the edge", () => {
	const as = (cookie: string) => ({ ...json, cookie });

	it("refuses a body of the wrong shape as `invalid_sale`, not as a bad user", async () => {
		const reply = await appWith(loggedIn).inject({
			method: "POST",
			url: "/admin/sales",
			headers: as(OPERATOR_COOKIE),
			payload: JSON.stringify({ stock: "many" }),
		});
		expect(reply.statusCode).toBe(400);
		expect(reply.json()).toEqual(errorPayload("invalid_sale"));
	});

	it("refuses a change with a field of the wrong type as `invalid_sale`", async () => {
		const reply = await appWith(loggedIn).inject({
			method: "PATCH",
			url: `/admin/sales/${MISSING_SALE}`,
			headers: as(OPERATOR_COOKIE),
			payload: JSON.stringify({ stock: "many" }),
		});
		expect(reply.statusCode).toBe(400);
		expect(reply.json()).toEqual(errorPayload("invalid_sale"));
	});

	it("refuses a body that is not JSON as `invalid_request`", async () => {
		const reply = await appWith(loggedIn).inject({
			method: "POST",
			url: "/admin/sales",
			headers: as(OPERATOR_COOKIE),
			payload: "{oops",
		});
		expect(reply.statusCode).toBe(400);
		expect(reply.json()).toEqual(errorPayload("invalid_request"));
	});

	it("checks the login before it reads the body", async () => {
		const reply = await appWith(loggedIn).inject({
			method: "POST",
			url: "/admin/sales",
			headers: json,
			payload: "{oops",
		});
		expect(reply.statusCode).toBe(401);
		expect(reply.json()).toEqual(errorPayload("not_authenticated"));
	});

	it("refuses a shopper as `forbidden` before it reads the body", async () => {
		const reply = await appWith(loggedIn).inject({
			method: "POST",
			url: "/admin/sales",
			headers: as(SHOPPER_COOKIE),
			payload: "{oops",
		});
		expect(reply.statusCode).toBe(403);
		expect(reply.json()).toEqual(errorPayload("forbidden"));
	});

	it("records the operator who is logged in as the author of the change", async () => {
		const actors: string[] = [];
		const app = appWith({
			...loggedIn,
			admin: {
				...healthyDeps.admin,
				remove: async (_id, actor) => {
					actors.push(actor);
					return new Ok(true as const);
				},
			},
		});
		const reply = await app.inject({
			method: "DELETE",
			url: `/admin/sales/${MISSING_SALE}`,
			headers: { cookie: OPERATOR_COOKIE },
		});
		expect(reply.statusCode).toBe(200);
		expect(actors).toEqual(["user-2"]);
	});

	it("counts every try by address and tells a client over the limit to wait", async () => {
		const seen: unknown[] = [];
		const app = appWith({
			...loggedIn,
			rateLimiter: {
				...healthyDeps.rateLimiter,
				check: async (request) => {
					seen.push(request);
					return { limited: true, retryAfterSeconds: 3 };
				},
			},
		});
		const reply = await app.inject({
			method: "POST",
			url: "/admin/sales",
			headers: json,
			payload: "{}",
		});
		expect(reply.statusCode).toBe(429);
		expect(reply.headers["retry-after"]).toBe("3");
		expect(seen).toHaveLength(1);
		expect(seen[0]).toMatchObject({ saleId: "admin", user: undefined });
	});
});
