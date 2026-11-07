// Guards: the checks a route runs before its handler. They say who is calling, whether the caller is an operator, and
// whether the caller is over a rate limit, and they refuse with the same replies on every route. A guard that lets a
// request through keeps the caller's login, and the handler reads it with `principalOf`, so no handler asks again.
// Inbound HTTP adapter.
import type { FastifyReply, FastifyRequest } from "fastify";
import type { Dependencies } from "../../../../application/dependencies.js";
import type { RateLimitVerdict } from "../../../../application/rate-limiter.js";
import type { Principal } from "../../../../domain/auth.js";
import type { UserId, Username } from "../../../../domain/user.js";
import { ACCESS_COOKIE, cookieValue } from "../cookies.js";
import { ERROR_STATUS, errorPayload, TICKET_HEADER } from "../errors.js";
import { sendError } from "./reply.js";

// The path parameter that every sale route has.
export type SaleParams = { saleId: string };

// The login of each request that a guard let through, keyed by the request object.
const principals = new WeakMap<object, Principal>();

// The login a guard checked. A route with a guard always has one here, so there is no check for a missing one.
export const principalOf = (request: FastifyRequest): Principal =>
	principals.get(request) as Principal;

// The name of the shopper who is logged in. The queue, the holds and the purchases are keyed on it.
export const shopperOf = (request: FastifyRequest): Username =>
	principalOf(request).username;

// The id of the operator who is logged in. It is recorded as the author of what the operator changes.
export const operatorOf = (request: FastifyRequest): UserId =>
	principalOf(request).userId;

// The admin routes are counted under this name, not under a sale id. A sale id is a UUID, so the name cannot clash with one.
const ADMIN_BUCKET = "admin";

// The queue ticket, read from its header. A header that is not text is the same as no ticket.
export const ticketOf = (
	request: Pick<FastifyRequest, "headers">,
): string | undefined => {
	const ticket = request.headers[TICKET_HEADER];
	return typeof ticket === "string" ? ticket : undefined;
};

// The reply that tells a client over its limit to wait, or nothing when the verdict lets it on.
function refuseWhenLimited(
	reply: FastifyReply,
	verdict: RateLimitVerdict,
): FastifyReply | undefined {
	if (!verdict.limited) return undefined;
	return reply
		.code(ERROR_STATUS.rate_limited)
		.header("retry-after", String(verdict.retryAfterSeconds))
		.send({
			...errorPayload("rate_limited"),
			retryAfterSeconds: verdict.retryAfterSeconds,
		});
}

// The guards, built on the application's services. A route takes the ones it needs.
export function createGuards(deps: Dependencies) {
	// Who the request is from, by its access cookie. It refuses nothing itself.
	const identify = (request: Pick<FastifyRequest, "headers">) =>
		deps.auth.authenticate(cookieValue(request.headers.cookie, ACCESS_COOKIE));

	// The login of a shopper or of an operator. Without one, the request stops here.
	const needSession = async (request: FastifyRequest, reply: FastifyReply) => {
		const who = await identify(request);
		if (who.isErr()) return sendError(reply, "not_authenticated");
		principals.set(request, who.value);
	};

	// Only an operator may pass. A shopper who is logged in is refused as `forbidden`, not as an unknown login.
	const needOperator = async (request: FastifyRequest, reply: FastifyReply) => {
		const who = await deps.auth.authorizeOperator(
			cookieValue(request.headers.cookie, ACCESS_COOKIE),
		);
		if (who.isErr()) return sendError(reply, who.error);
		principals.set(request, who.value);
	};

	// Runs before the body is checked, so a bad request is counted too. A client over its limit is told to wait, and the
	// route never runs. The shopper is the one who is logged in; a request with no login still counts against its address
	// and is then refused.
	const limit = async (
		request: FastifyRequest & { params: SaleParams },
		reply: FastifyReply,
	) => {
		const who = await identify(request);
		const limited = refuseWhenLimited(
			reply,
			await deps.rateLimiter.check({
				saleId: request.params.saleId,
				user: who.isOk() ? who.value.username : undefined,
				ip: request.ip,
			}),
		);
		if (limited) return limited;
		if (who.isErr()) return sendError(reply, "not_authenticated");
		principals.set(request, who.value);
	};

	// The admin routes count by address only, and before anything is read, so a guess is counted too.
	const limitAdmin = async (
		request: Pick<FastifyRequest, "ip">,
		reply: FastifyReply,
	) =>
		refuseWhenLimited(
			reply,
			await deps.rateLimiter.check({
				saleId: ADMIN_BUCKET,
				user: undefined,
				ip: request.ip,
			}),
		);

	// The auth routes count by address alone, with a limit of their own.
	const limitAuth = async (
		request: Pick<FastifyRequest, "ip">,
		reply: FastifyReply,
	) =>
		refuseWhenLimited(
			reply,
			await deps.rateLimiter.checkAuth({ ip: request.ip }),
		);

	return { needSession, needOperator, limit, limitAdmin, limitAuth };
}
