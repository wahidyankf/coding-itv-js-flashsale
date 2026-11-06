// The shapes that go over the wire. Dates are ISO strings, as JSON carries them.

import { z } from "zod";
import { ERROR_STATUS, type ErrorCode, SALE_STATUSES } from "./vocabulary.js";

export const SaleView = z.object({
	id: z.string(),
	name: z.string(),
	status: z.enum(SALE_STATUSES),
	startsAt: z.iso.datetime(),
	endsAt: z.iso.datetime(),
	stock: z.number().int().nonnegative(),
	remaining: z.number().int().nonnegative(),
});
export type SaleView = z.infer<typeof SaleView>;

// Where a user stands in the queue of one sale, with the user the answer is about.
export const PlaceView = z.discriminatedUnion("state", [
	z.object({
		userId: z.string(),
		state: z.literal("waiting"),
		place: z.number().int().nonnegative(),
	}),
	z.object({ userId: z.string(), state: z.literal("admitted") }),
	z.object({ userId: z.string(), state: z.literal("absent") }),
]);
export type PlaceView = z.infer<typeof PlaceView>;

// The place a shopper gets on joining, with the ticket that proves it.
export const JoinedView = z.discriminatedUnion("state", [
	z.object({
		userId: z.string(),
		ticket: z.string(),
		state: z.literal("waiting"),
		place: z.number().int().nonnegative(),
	}),
	z.object({
		userId: z.string(),
		ticket: z.string(),
		state: z.literal("admitted"),
	}),
	z.object({
		userId: z.string(),
		ticket: z.string(),
		state: z.literal("absent"),
	}),
]);
export type JoinedView = z.infer<typeof JoinedView>;

export const ReservedView = z.object({
	userId: z.string(),
	reservationId: z.string(),
	expiresAt: z.iso.datetime(),
});
export type ReservedView = z.infer<typeof ReservedView>;

export const PurchaseView = z.object({
	userId: z.string(),
	purchaseId: z.string(),
	reservationId: z.string(),
	purchasedAt: z.iso.datetime(),
});
export type PurchaseView = z.infer<typeof PurchaseView>;

// "Did I get it?": a purchase, a live hold, or nothing.
export const OutcomeView = z.discriminatedUnion("state", [
	PurchaseView.extend({ state: z.literal("purchased") }),
	ReservedView.extend({ state: z.literal("holding") }),
	z.object({ userId: z.string(), state: z.literal("none") }),
]);
export type OutcomeView = z.infer<typeof OutcomeView>;

export const HealthView = z.object({ status: z.literal("ok") });

export const ReadyView = z.discriminatedUnion("status", [
	z.object({
		status: z.literal("ok"),
		checks: z.object({ database: z.literal("ok"), redis: z.literal("ok") }),
	}),
	z.object({
		status: z.literal("unavailable"),
		checks: z.object({
			database: z.enum(["ok", "error"]),
			redis: z.enum(["ok", "error"]),
		}),
	}),
]);
export type ReadyView = z.infer<typeof ReadyView>;

// What a request body must hold. Whether a name is usable is decided by the format rules, not by the shape.
export const UserBody = z.object({ userId: z.string() });
export const ConfirmBody = z.object({
	userId: z.string(),
	reservationId: z.string(),
});

export const SaleParams = z.object({ saleId: z.string() });
export const PlaceParams = z.object({ saleId: z.string(), userId: z.string() });
export const TicketHeaders = z.object({
	"x-queue-ticket": z.string().optional(),
});

export const RateLimitedBody = z.object({
	error: z.literal("rate_limited"),
	retryAfterSeconds: z.number().int().nonnegative(),
});

// An error reply is always `{ error: code }`.
export function errorBody<const C extends ErrorCode>(
	codes: readonly C[],
): z.ZodType<{ error: C }> {
	return z.object({ error: z.enum(codes) });
}

export type StatusOf<C extends ErrorCode> = (typeof ERROR_STATUS)[C];

// The error replies of an operation, one schema per HTTP status, each listing only the codes with that status.
export type ErrorReplies<C extends ErrorCode> = {
	[S in StatusOf<C>]: z.ZodType<{
		error: { [K in C]: StatusOf<K> extends S ? K : never }[C];
	}>;
};

export function errorReplies<const C extends ErrorCode>(
	codes: readonly C[],
): ErrorReplies<C> {
	const byStatus = new Map<number, C[]>();
	for (const code of codes) {
		const status = ERROR_STATUS[code];
		byStatus.set(status, [...(byStatus.get(status) ?? []), code]);
	}
	// One cast: the keys are built at run time, and the type above says what they are.
	return Object.fromEntries(
		[...byStatus].map(([status, group]) => [status, errorBody(group)]),
	) as ErrorReplies<C>;
}

// Any error reply, whatever the operation: used to tell a refusal from a reply that broke the contract.
export const ErrorBody = z.object({
	error: z.enum(Object.keys(ERROR_STATUS) as [ErrorCode, ...ErrorCode[]]),
});
