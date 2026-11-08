// Unit tests for the log of the HTTP app, written to a captured stream: one JSON line per request and reply with its id,
// method, path, status and time; no password, token or cookie in any line; and the request id that a caller sends, kept
// only when it is a UUID and sent back on every reply.
import { isUuid } from "@flash/flash-commons";
import { Ok } from "@flash/typekit";
import { afterEach, describe, expect, it } from "vitest";
import type { Dependencies } from "../../../application/dependencies.js";
import { healthyDeps } from "../../../bdd/support/deps.js";
import { usernameOf } from "../../../bdd/support/users.js";
import type { Principal } from "../../../domain/auth.js";
import { userIdOf } from "../../../domain/user.js";
import { buildApp, createLogger } from "./app.js";

const apps: Array<ReturnType<typeof buildApp>> = [];
afterEach(async () => {
	await Promise.all(apps.splice(0).map((app) => app.close()));
});

// An app that logs at `info` into `lines`, one parsed JSON object per line.
function loggingApp(deps: Dependencies = healthyDeps) {
	const lines: Array<Record<string, unknown>> = [];
	const raw: string[] = [];
	const app = buildApp(deps, {
		cookieSecure: false,
		logger: createLogger({
			level: "info",
			stream: {
				write: (line: string) => {
					raw.push(line);
					lines.push(JSON.parse(line) as Record<string, unknown>);
				},
			},
		}),
	});
	apps.push(app);
	return { app, lines, raw };
}

const PASSWORD = "a very long secret password";
const ACCESS = "access-token-value-1234";
const REFRESH = "refresh-token-value-5678";
const principal: Principal = {
	userId: userIdOf("user-1"),
	username: usernameOf("ana"),
	role: "shopper",
};
const login = {
	principal,
	accessToken: ACCESS,
	accessExpiresAt: new Date("2026-06-01T12:15:00Z"),
	refreshToken: REFRESH,
	refreshExpiresAt: new Date("2026-06-08T12:00:00Z"),
};
const accounts: Dependencies = {
	...healthyDeps,
	auth: {
		...healthyDeps.auth,
		register: async () => new Ok(login),
		login: async () => new Ok(login),
		refresh: async () => new Ok(login),
		logout: async () => {},
	},
};
const json = { "content-type": "application/json" };
const body = JSON.stringify({ username: "ana", password: PASSWORD });
const cookies = `access_token=${ACCESS}; refresh_token=${REFRESH}`;

describe("the log of a sign-up, a login, a refresh and a logout", () => {
	it("has a line per request and per reply with its id, method, path, status and time, and no secret", async () => {
		const { app, lines, raw } = loggingApp(accounts);
		const requests = [
			{ url: "/api/v1/auth/register", headers: json, payload: body },
			{ url: "/api/v1/auth/login", headers: json, payload: body },
			{
				url: "/api/v1/auth/refresh",
				headers: { cookie: cookies, authorization: `Bearer ${ACCESS}` },
			},
			{ url: "/api/v1/auth/logout", headers: { cookie: cookies } },
		];
		for (const request of requests) {
			const reply = await app.inject({ method: "POST", ...request });
			expect(reply.statusCode).toBeLessThan(300);
		}

		const incoming = lines.filter((line) => line.msg === "incoming request");
		const completed = lines.filter((line) => line.msg === "request completed");
		expect(incoming.map((line) => (line.req as { url: string }).url)).toEqual(
			requests.map((request) => request.url),
		);
		for (const line of incoming) {
			expect(isUuid(String(line.reqId))).toBe(true);
			expect((line.req as { method: string }).method).toBe("POST");
		}
		expect(completed).toHaveLength(requests.length);
		for (const line of completed) {
			expect(isUuid(String(line.reqId))).toBe(true);
			expect((line.res as { statusCode: number }).statusCode).toBeTypeOf(
				"number",
			);
			expect(line.responseTime).toBeTypeOf("number");
		}

		const text = raw.join("");
		for (const secret of [
			PASSWORD,
			ACCESS,
			REFRESH,
			"access_token",
			"refresh_token",
		]) {
			expect(text).not.toContain(secret);
		}
		expect(text.toLowerCase()).not.toContain("set-cookie");
		expect(text.toLowerCase()).not.toContain("authorization");
	});

	it("hides the cookie and authorization headers, and the cookies of a reply, if a line ever holds them", () => {
		const { app, raw } = loggingApp();
		// A child whose serializers keep the headers, as a future serializer might.
		const keepHeaders = (value: unknown) => value;
		app.log
			.child({}, { serializers: { req: keepHeaders, res: keepHeaders } })
			.info(
				{
					req: {
						headers: { cookie: cookies, authorization: `Bearer ${ACCESS}` },
					},
					res: { headers: { "set-cookie": [`access_token=${ACCESS}`] } },
				},
				"a line with headers",
			);
		const text = raw.join("");
		expect(text).toContain("a line with headers");
		expect(text).not.toContain(ACCESS);
		expect(text).not.toContain(REFRESH);
	});
});

describe("the log level", () => {
	// The server writes to standard output when no stream is given; at `silent` it writes nothing there either.
	it("writes nothing at `silent`, and still answers", async () => {
		const app = buildApp(healthyDeps, {
			cookieSecure: false,
			logger: createLogger({ level: "silent" }),
		});
		apps.push(app);
		expect(app.log.level).toBe("silent");
		expect(
			(await app.inject({ method: "GET", url: "/health" })).statusCode,
		).toBe(200);
	});

	// main.ts writes the config line before the app exists, with the logger it then gives the app.
	it("is one log: a line written before the app and the lines of its requests go to the same place", async () => {
		const raw: string[] = [];
		const logger = createLogger({
			level: "info",
			stream: { write: (line: string) => raw.push(line) },
		});
		logger.info({ port: 8080 }, "flash-be config");
		const app = buildApp(healthyDeps, { cookieSecure: false, logger });
		apps.push(app);
		await app.inject({ method: "GET", url: "/health" });
		const messages = raw.map(
			(line) => (JSON.parse(line) as { msg: string }).msg,
		);
		expect(messages).toEqual([
			"flash-be config",
			"incoming request",
			"request completed",
		]);
	});
});

describe("the request id", () => {
	const ID = "3f0c1a52-5d7e-4b8a-9c1d-2e3f4a5b6c7d";

	it("keeps an id that is a UUID, in the log and in the reply", async () => {
		const { app, lines } = loggingApp();
		const reply = await app.inject({
			method: "GET",
			url: "/health",
			headers: { "x-request-id": ID },
		});
		expect(reply.headers["x-request-id"]).toBe(ID);
		expect(lines.filter((line) => line.reqId === ID)).toHaveLength(2);
	});

	it.each([
		["missing", {}],
		["not a UUID", { "x-request-id": "hello\nforged log line" }],
		["empty", { "x-request-id": "" }],
	])("makes a new UUID when the caller's id is %s", async (_case, headers) => {
		const { app, lines } = loggingApp();
		const reply = await app.inject({ method: "GET", url: "/health", headers });
		const id = String(reply.headers["x-request-id"]);
		expect(isUuid(id)).toBe(true);
		expect(
			lines.every((line) => line.reqId === undefined || line.reqId === id),
		).toBe(true);
		expect(JSON.stringify(lines)).not.toContain("forged");
	});

	it("is on an error reply too", async () => {
		const { app } = loggingApp();
		const missing = await app.inject({
			method: "GET",
			url: "/nowhere",
			headers: { "x-request-id": ID },
		});
		expect(missing.statusCode).toBe(404);
		expect(missing.headers["x-request-id"]).toBe(ID);
		const broken = await app.inject({
			method: "POST",
			url: "/api/v1/auth/login",
			headers: json,
			payload: "{oops",
		});
		expect(broken.statusCode).toBe(400);
		expect(isUuid(String(broken.headers["x-request-id"]))).toBe(true);
	});

	it("is on an event stream too", async () => {
		const app = buildApp(
			{
				...healthyDeps,
				sales: {
					...healthyDeps.sales,
					byId: async () => ({
						sale: {
							id: "s",
							productId: "p",
							name: "Flash sale",
							startsAt: new Date(0),
							endsAt: new Date(0),
							stock: 1,
							sold: 0,
							holdSeconds: 1,
							admitPerSecond: 1,
						},
						status: "ended" as const,
					}),
				},
			},
			{ cookieSecure: false },
		);
		apps.push(app);
		const origin = await app.listen({ host: "127.0.0.1", port: 0 });
		const controller = new AbortController();
		const reply = await fetch(`${origin}/api/v1/sales/s/events`, {
			headers: { "x-request-id": ID },
			signal: controller.signal,
		});
		expect(reply.headers.get("x-request-id")).toBe(ID);
		controller.abort();
	});
});
