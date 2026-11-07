// The queue ticket: proof that a shopper went through the queue for a sale. It is a signature, so any instance can make
// and check it with the shared secret, and it needs no storage that a Redis restart could lose.
import { createHmac, timingSafeEqual } from "node:crypto";
import type { Username } from "./user.js";

// The ticket of this shopper in this sale. It proves the queue let them in, not who they are.
export function issueTicket(
	secret: string,
	saleId: string,
	user: Username,
): string {
	return createHmac("sha256", secret)
		.update(`${saleId}:${user}`)
		.digest("base64url");
}

// Whether the ticket the client sent is the one this sale and shopper would get. A missing ticket never matches.
export function ticketMatches(
	secret: string,
	saleId: string,
	user: Username,
	ticket: string | undefined,
): boolean {
	if (!ticket) return false;
	const expected = Buffer.from(issueTicket(secret, saleId, user));
	const given = Buffer.from(ticket);
	return given.length === expected.length && timingSafeEqual(given, expected);
}
