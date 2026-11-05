import { createHmac, timingSafeEqual } from "node:crypto";

// A ticket is a signature of the sale and the user. Any instance can issue and check it with the shared secret, so it
// needs no storage and survives a Redis restart. It proves the shopper went through the queue, not who they are.
export function issueTicket(
	secret: string,
	saleId: string,
	user: string,
): string {
	return createHmac("sha256", secret)
		.update(`${saleId}:${user}`)
		.digest("base64url");
}

export function ticketMatches(
	secret: string,
	saleId: string,
	user: string,
	ticket: string | undefined,
): boolean {
	if (!ticket) return false;
	const expected = Buffer.from(issueTicket(secret, saleId, user));
	const given = Buffer.from(ticket);
	return given.length === expected.length && timingSafeEqual(given, expected);
}
