// The reply helpers the Redis adapters share: the one failure a Redis-backed port reports for a reply it cannot read, and the
// read of a script's list reply. Outbound adapter helper; it reads a reply and does no I/O.
import { Err, Ok, type Result } from "@flash/typekit";
import type { UnreadableReply } from "../../../application/ports/reply.js";

// The failure of a reply that a script does not write. Named once, so every Redis adapter says the same thing.
export const UNREADABLE: UnreadableReply = "unreadable_reply";

// A script's reply as a list. Redis answers a script that writes a list with an array; any other reply is not one the
// script writes, so it is the failure, and the caller treats the store as unreadable.
export function arrayReply(reply: unknown): Result<unknown[], UnreadableReply> {
	if (!Array.isArray(reply)) return new Err(UNREADABLE);
	const parts: unknown[] = reply;
	return new Ok(parts);
}
