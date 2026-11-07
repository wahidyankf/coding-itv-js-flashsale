import { attemptAsync } from "@flash/typekit";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Login } from "../../../application/auth-service.js";
import type { Dependencies } from "../../../application/dependencies.js";
import type { SaleView } from "../../../application/sale-view.js";
import {
	ACCESS_COOKIE,
	ACCESS_TTL_SECONDS,
	cookieValue,
	cutUserAgent,
	type Principal,
	REFRESH_COOKIE,
	REFRESH_COOKIE_PATH,
	REFRESH_TTL_SECONDS,
	setCookie,
} from "../../../domain/auth.js";
import type { Purchase } from "../../../domain/purchase.js";
import type { QueuePlace } from "../../../domain/queue.js";
import type { SaleDraft, SalePatch } from "../../../domain/sale-window.js";
import { MS_PER_SECOND } from "../../../domain/time.js";
import {
	ERROR_STATUS,
	errorPayload,
	HTTP_STATUS,
	TICKET_HEADER,
} from "./errors.js";
import { type StreamOptions, serveEvents } from "./event-stream.js";

type SaleParams = { saleId: string };

// A user agent longer than this is cut before it is stored.

// The ticket is one header; anything else is the same as no ticket.
const ticketOf = (request: Pick<FastifyRequest, "headers">) => {
	const ticket = request.headers[TICKET_HEADER];
	return typeof ticket === "string" ? ticket : undefined;
};

// A field of a value that has not been checked yet, such as a body.
const fieldOf = (source: unknown, name: string): unknown =>
	typeof source === "object" && source !== null && name in source
		? Reflect.get(source, name)
		: undefined;

// A body field that is missing or not a string is refused with the code of that field, before anything else is looked at.
const FIELD_ERROR = {
	reservationId: "invalid_reservation",
} as const;
const missingField = (
	body: unknown,
	fields: ReadonlyArray<keyof typeof FIELD_ERROR>,
) => fields.find((name) => typeof fieldOf(body, name) !== "string");

// A sale to create, if the body has the right types. Whether the values make a usable sale is the rule of the domain.
function saleDraftOf(body: unknown): SaleDraft | undefined {
	const field = (name: string) => fieldOf(body, name);
	const optional = (name: string, type: "string" | "number") =>
		field(name) === undefined || typeof field(name) === type;
	const productId = field("productId");
	const name = field("name");
	const stock = field("stock");
	const startsAt = field("startsAt");
	const endsAt = field("endsAt");
	const holdSeconds = field("holdSeconds");
	const admitPerSecond = field("admitPerSecond");
	if (
		typeof stock !== "number" ||
		typeof startsAt !== "string" ||
		typeof endsAt !== "string" ||
		!optional("productId", "string") ||
		!optional("name", "string") ||
		!optional("holdSeconds", "number") ||
		!optional("admitPerSecond", "number")
	) {
		return undefined;
	}
	return {
		productId: productId as string | undefined,
		name: name as string | undefined,
		stock,
		startsAt,
		endsAt,
		holdSeconds: holdSeconds as number | undefined,
		admitPerSecond: admitPerSecond as number | undefined,
	};
}

// The type each field of a sale change must have, if it is there.
const PATCH_FIELD_TYPE = {
	name: "string",
	startsAt: "string",
	endsAt: "string",
	stock: "number",
	holdSeconds: "number",
	admitPerSecond: "number",
} as const;

// A change to a sale, if every field that is there has the right type. A body with no field at all gives an empty
// change, which the domain refuses.
function salePatchOf(body: unknown): SalePatch | undefined {
	const patch: Record<string, unknown> = {};
	for (const [name, type] of Object.entries(PATCH_FIELD_TYPE)) {
		const value = fieldOf(body, name);
		if (value === undefined) continue;
		if (typeof value !== type) return undefined;
		patch[name] = value;
	}
	return patch as SalePatch;
}

// All routes are registered here. The paths, what each route takes and the replies are in docs/reference/http-endpoints.md.
export function registerRoutes(
	root: FastifyInstance,
	deps: Dependencies,
	stream: StreamOptions,
	// Whether the cookies are sent over HTTPS only. Behind plain HTTP (local development) they cannot be.
	cookies: { secure: boolean },
): void {
	const app = root;

	const tellToWait = (
		reply: FastifyReply,
		verdict: Awaited<ReturnType<Dependencies["rateLimiter"]["check"]>>,
	) => {
		if (!verdict.limited) return;
		return reply
			.code(ERROR_STATUS.rate_limited)
			.header("retry-after", String(verdict.retryAfterSeconds))
			.send({
				...errorPayload("rate_limited"),
				retryAfterSeconds: verdict.retryAfterSeconds,
			});
	};

	// Who a request is from. A route that needs a login asks `needSession` or `needOperator`, which fill this in.
	const principals = new WeakMap<object, Principal>();
	const identify = async (request: Pick<FastifyRequest, "headers">) =>
		deps.auth.authenticate(cookieValue(request.headers.cookie, ACCESS_COOKIE));
	const refuseLogin = (reply: FastifyReply) =>
		reply
			.code(ERROR_STATUS.not_authenticated)
			.send(errorPayload("not_authenticated"));

	// The login of a shopper or of an operator.
	const needSession = async (request: FastifyRequest, reply: FastifyReply) => {
		const who = await identify(request);
		if (who.isErr()) return refuseLogin(reply);
		principals.set(request, who.value);
	};

	// Only an operator may pass; a shopper who is logged in is refused as such.
	const needOperator = async (request: FastifyRequest, reply: FastifyReply) => {
		const who = await identify(request);
		if (who.isErr()) return refuseLogin(reply);
		if (who.value.role !== "operator") {
			return reply.code(ERROR_STATUS.forbidden).send(errorPayload("forbidden"));
		}
		principals.set(request, who.value);
	};

	// Who a request is from. A guard has run before any handler and filled this in, so there is always someone.
	const principalOf = (request: FastifyRequest): Principal =>
		principals.get(request) as Principal;
	const shopperOf = (request: FastifyRequest): string =>
		principalOf(request).username;
	const operatorOf = (request: FastifyRequest): string =>
		principalOf(request).userId;

	// Runs before the body is checked, so a bad request is counted too. A client over its limit is told to wait, and
	// the route never runs. The shopper is the one who is logged in; a request with no login still counts against its
	// address and is then refused.
	const limit = async (
		request: FastifyRequest & { params: { saleId: string } },
		reply: FastifyReply,
	) => {
		const who = await identify(request);
		const limited = tellToWait(
			reply,
			await deps.rateLimiter.check({
				saleId: request.params.saleId,
				user: who.isOk() ? who.value.username : undefined,
				ip: request.ip,
			}),
		);
		if (limited) return limited;
		if (who.isErr()) return refuseLogin(reply);
		principals.set(request, who.value);
	};

	// The admin and auth routes count by address only, and before anything is read, so a guess is counted too. The auth
	// routes have a limit of their own.
	const limitAdmin = async (
		request: Pick<FastifyRequest, "ip">,
		reply: FastifyReply,
	) =>
		tellToWait(
			reply,
			await deps.rateLimiter.check({
				saleId: "admin",
				user: undefined,
				ip: request.ip,
			}),
		);
	const limitAuth = async (
		request: Pick<FastifyRequest, "ip">,
		reply: FastifyReply,
	) => tellToWait(reply, await deps.rateLimiter.checkAuth({ ip: request.ip }));

	// The two cookies of a login, or the same two emptied.
	const loginCookies = (login: Login) => [
		setCookie(ACCESS_COOKIE, login.accessToken, {
			maxAgeSeconds: ACCESS_TTL_SECONDS,
			path: "/",
			secure: cookies.secure,
		}),
		setCookie(REFRESH_COOKIE, login.refreshToken, {
			maxAgeSeconds: REFRESH_TTL_SECONDS,
			path: REFRESH_COOKIE_PATH,
			secure: cookies.secure,
		}),
	];
	const clearedCookies = () => [
		setCookie(ACCESS_COOKIE, "", {
			maxAgeSeconds: 0,
			path: "/",
			secure: cookies.secure,
		}),
		setCookie(REFRESH_COOKIE, "", {
			maxAgeSeconds: 0,
			path: REFRESH_COOKIE_PATH,
			secure: cookies.secure,
		}),
	];
	// What the server knows of the client, for the record of a login. A user agent is cut, as it is client text.
	const clientOf = (request: Pick<FastifyRequest, "headers" | "ip">) => {
		const agent = request.headers["user-agent"];
		return {
			ip: request.ip,
			userAgent: cutUserAgent(agent),
		};
	};
	const accountView = (principal: Principal) => ({
		username: principal.username,
		role: principal.role,
	});

	// Signing up makes a shopper account and logs it in. The cookies are the only place the tokens are sent.
	app.route({
		method: "POST",
		url: "/auth/register",
		onRequest: limitAuth,
		handler: async (request, reply) => {
			const created = await deps.auth.register(
				fieldOf(request.body, "username"),
				fieldOf(request.body, "password"),
				clientOf(request),
			);
			if (created.isErr()) {
				return reply
					.code(ERROR_STATUS[created.error])
					.send(errorPayload(created.error));
			}
			return reply
				.header("set-cookie", loginCookies(created.value))
				.code(HTTP_STATUS.created)
				.send(accountView(created.value.principal));
		},
	});

	app.route({
		method: "POST",
		url: "/auth/login",
		onRequest: limitAuth,
		handler: async (request, reply) => {
			const login = await deps.auth.login(
				fieldOf(request.body, "username"),
				fieldOf(request.body, "password"),
				clientOf(request),
			);
			if (login.isErr()) {
				return reply
					.code(ERROR_STATUS[login.error])
					.send(errorPayload(login.error));
			}
			return reply
				.header("set-cookie", loginCookies(login.value))
				.code(HTTP_STATUS.ok)
				.send(accountView(login.value.principal));
		},
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
			if (refreshed.isErr()) {
				return reply
					.header("set-cookie", clearedCookies())
					.code(ERROR_STATUS[refreshed.error])
					.send(errorPayload(refreshed.error));
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

	// Public sale reads may be kept for the cache time, by this server and by the client.
	const cacheable = <R extends FastifyReply>(reply: R): R => {
		const ms = deps.sales.cacheMs();
		return ms > 0
			? (reply.header(
					"cache-control",
					`public, max-age=${Math.ceil(ms / MS_PER_SECOND)}`,
				) as R)
			: reply;
	};

	app.route({
		method: "GET",
		url: "/health",
		handler: async () => ({ status: "ok" as const }),
	});

	// Readiness: Postgres and Redis both answer.
	app.route({
		method: "GET",
		url: "/ready",
		handler: async (_request, reply) => {
			const database = await attemptAsync(() => deps.checkDatabase(), Error);
			const redis = await attemptAsync(() => deps.checkRedis(), Error);
			if (database.isOk() && redis.isOk()) {
				return reply
					.code(HTTP_STATUS.ok)
					.send({ status: "ok", checks: { database: "ok", redis: "ok" } });
			}
			return reply.code(ERROR_STATUS.unavailable).send({
				status: "unavailable",
				checks: {
					database: database.isOk() ? "ok" : "error",
					redis: redis.isOk() ? "ok" : "error",
				},
			});
		},
	});

	// The sale a shopper sees. "current" is the running sale, else the one that opens next, else none.
	app.route({
		method: "GET",
		url: "/sales/current",
		handler: async (_request, reply) => {
			const sale = await deps.sales.current();
			if (!sale)
				return reply
					.code(ERROR_STATUS.sale_not_found)
					.send(errorPayload("sale_not_found"));
			return cacheable(reply).code(HTTP_STATUS.ok).send(sale);
		},
	});

	app.route<{ Params: SaleParams }>({
		method: "GET",
		url: "/sales/:saleId",
		handler: async (request, reply) => {
			const sale = await deps.sales.byId(request.params.saleId);
			if (!sale)
				return reply
					.code(ERROR_STATUS.sale_not_found)
					.send(errorPayload("sale_not_found"));
			return cacheable(reply).code(HTTP_STATUS.ok).send(sale);
		},
	});

	// Live updates. The status is read through the same cache as the plain read, so any number of watchers cost one
	// database read per cache time.
	app.route<{ Params: SaleParams }>({
		method: "GET",
		url: "/sales/:saleId/events",
		handler: async (request, reply) => {
			const { saleId } = request.params;
			if (!(await deps.sales.byId(saleId))) {
				return reply
					.code(ERROR_STATUS.sale_not_found)
					.send(errorPayload("sale_not_found"));
			}
			return serveEvents(
				request,
				reply,
				async () => {
					const sale = await deps.sales.byId(saleId);
					if (!sale) throw new Error("the sale is gone");
					return {
						event: "sale",
						data: sale,
					} satisfies SaleEvent;
				},
				stream,
				(error) => request.log.warn({ err: error }, "event read failed"),
			);
		},
	});

	// The place of the shopper who is logged in, pushed when it changes. The ticket is checked once, when the stream opens.
	app.route<{ Params: SaleParams }>({
		method: "GET",
		url: "/sales/:saleId/queue/me/events",
		preValidation: needSession,
		handler: async (request, reply) => {
			const { saleId } = request.params;
			const userId = shopperOf(request);
			const ticket = ticketOf(request);
			const first = await deps.queue.check(saleId, userId, ticket);
			if (first.isErr()) {
				return reply
					.code(ERROR_STATUS[first.error])
					.send(errorPayload(first.error));
			}
			const { user } = first.value;
			return serveEvents(
				request,
				reply,
				async () => {
					const latest = await deps.queue.check(saleId, userId, ticket);
					const place = latest.isOk()
						? latest.value.place
						: ({ state: "absent" } as const);
					return {
						event: "place",
						data: { userId: user, ...place },
					} satisfies PlaceEvent;
				},
				stream,
				(error) => request.log.warn({ err: error }, "event read failed"),
			);
		},
	});

	// The waiting queue. A ticket proves the shopper joined; it is sent back in the reply body.
	app.route<{ Params: SaleParams }>({
		method: "POST",
		url: "/sales/:saleId/queue",
		preValidation: limit,
		handler: async (request, reply) => {
			const joined = await deps.queue.join(
				request.params.saleId,
				shopperOf(request),
			);
			if (joined.isErr()) {
				return reply
					.code(ERROR_STATUS[joined.error])
					.send(errorPayload(joined.error));
			}
			const { created, user, ticket, place } = joined.value;
			return reply
				.code(created ? HTTP_STATUS.created : HTTP_STATUS.ok)
				.send({ userId: user, ticket, ...place });
		},
	});

	app.route<{ Params: SaleParams }>({
		method: "GET",
		url: "/sales/:saleId/queue/me",
		preValidation: needSession,
		handler: async (request, reply) => {
			const checked = await deps.queue.check(
				request.params.saleId,
				shopperOf(request),
				ticketOf(request),
			);
			if (checked.isErr()) {
				return reply
					.code(ERROR_STATUS[checked.error])
					.send(errorPayload(checked.error));
			}
			return reply
				.code(HTTP_STATUS.ok)
				.send({ userId: checked.value.user, ...checked.value.place });
		},
	});

	// An admitted shopper holds one item for the sale's hold time. Asking again returns the same hold.
	app.route<{ Params: SaleParams }>({
		method: "POST",
		url: "/sales/:saleId/reservations",
		preValidation: limit,
		handler: async (request, reply) => {
			const reserved = await deps.reservations.reserve(
				request.params.saleId,
				shopperOf(request),
				ticketOf(request),
			);
			if (reserved.isErr()) {
				return reply
					.code(ERROR_STATUS[reserved.error])
					.send(errorPayload(reserved.error));
			}
			const { created, user, reservationId, expiresAt } = reserved.value;
			return reply.code(created ? HTTP_STATUS.created : HTTP_STATUS.ok).send({
				userId: user,
				reservationId,
				expiresAt: expiresAt.toISOString(),
			});
		},
	});

	// Pays for the held item. The reservation id makes it safe to send twice.
	app.route<{ Params: SaleParams }>({
		method: "POST",
		url: "/sales/:saleId/purchases",
		preValidation: limit,
		handler: async (request, reply) => {
			const bad = missingField(request.body, ["reservationId"]);
			if (bad) {
				return reply
					.code(ERROR_STATUS[FIELD_ERROR[bad]])
					.send(errorPayload(FIELD_ERROR[bad]));
			}
			const confirmed = await deps.purchases.confirm(
				request.params.saleId,
				shopperOf(request),
				fieldOf(request.body, "reservationId"),
			);
			if (confirmed.isErr()) {
				return reply
					.code(ERROR_STATUS[confirmed.error])
					.send(errorPayload(confirmed.error));
			}
			const { created, purchase } = confirmed.value;
			return reply
				.code(created ? HTTP_STATUS.created : HTTP_STATUS.ok)
				.send(purchaseView(purchase));
		},
	});

	// An operator creates a sale. The window must not overlap another sale.
	app.route({
		method: "POST",
		url: "/admin/sales",
		// onRequest runs before the body is read, so a client without the token learns nothing from a broken body.
		onRequest: [limitAdmin, needOperator],
		handler: async (request, reply) => {
			const draft = saleDraftOf(request.body);
			if (draft === undefined) {
				return reply
					.code(ERROR_STATUS.invalid_sale)
					.send(errorPayload("invalid_sale"));
			}
			const created = await deps.admin.create(draft, operatorOf(request));
			if (created.isErr()) {
				return reply
					.code(ERROR_STATUS[created.error])
					.send(errorPayload(created.error));
			}
			return reply.code(HTTP_STATUS.created).send(created.value);
		},
	});

	// An operator reads every sale, with the numbers that only an operator needs.
	app.route({
		method: "GET",
		url: "/admin/sales",
		onRequest: [limitAdmin, needOperator],
		handler: async (_request, reply) =>
			reply.code(HTTP_STATUS.ok).send({ sales: await deps.admin.list() }),
	});

	// An operator changes a sale. What may change depends on whether the sale has started (see `changeSaleFrom`).
	app.route<{ Params: SaleParams }>({
		method: "PATCH",
		url: "/admin/sales/:saleId",
		onRequest: [limitAdmin, needOperator],
		handler: async (request, reply) => {
			const patch = salePatchOf(request.body);
			if (patch === undefined) {
				return reply
					.code(ERROR_STATUS.invalid_sale)
					.send(errorPayload("invalid_sale"));
			}
			const changed = await deps.admin.update(
				request.params.saleId,
				patch,
				operatorOf(request),
			);
			if (changed.isErr()) {
				return reply
					.code(ERROR_STATUS[changed.error])
					.send(errorPayload(changed.error));
			}
			return reply.code(HTTP_STATUS.ok).send(changed.value);
		},
	});

	// An operator removes a sale that nobody has bought from.
	app.route<{ Params: SaleParams }>({
		method: "DELETE",
		url: "/admin/sales/:saleId",
		onRequest: [limitAdmin, needOperator],
		handler: async (request, reply) => {
			const removed = await deps.admin.remove(
				request.params.saleId,
				operatorOf(request),
			);
			if (removed.isErr()) {
				return reply
					.code(ERROR_STATUS[removed.error])
					.send(errorPayload(removed.error));
			}
			return reply.code(HTTP_STATUS.ok).send({ id: request.params.saleId });
		},
	});

	// "Did I get it?": a purchase, a live hold, or nothing.
	app.route<{ Params: SaleParams }>({
		method: "GET",
		url: "/sales/:saleId/purchases/me",
		preValidation: needSession,
		handler: async (request, reply) => {
			const found = await deps.purchases.outcome(
				request.params.saleId,
				shopperOf(request),
			);
			if (found.isErr()) {
				return reply
					.code(ERROR_STATUS[found.error])
					.send(errorPayload(found.error));
			}
			const { user, outcome } = found.value;
			if (outcome.state === "purchased") {
				return reply
					.code(HTTP_STATUS.ok)
					.send({ ...purchaseView(outcome.purchase), state: "purchased" });
			}
			if (outcome.state === "holding") {
				return reply.code(HTTP_STATUS.ok).send({
					userId: user,
					state: "holding",
					reservationId: outcome.reservationId,
					expiresAt: outcome.expiresAt.toISOString(),
				});
			}
			return reply.code(HTTP_STATUS.ok).send({ userId: user, state: "none" });
		},
	});
}

type SaleEvent = { event: "sale"; data: SaleView };
type PlaceEvent = { event: "place"; data: { userId: string } & QueuePlace };

function purchaseView(purchase: Purchase) {
	return {
		userId: purchase.user,
		purchaseId: purchase.id,
		reservationId: purchase.reservationId,
		purchasedAt: purchase.purchasedAt.toISOString(),
	};
}
