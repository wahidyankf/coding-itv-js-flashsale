// The reply helpers the Redis adapters share: the one failure a Redis-backed port reports for a reply it cannot read, and the
// read of a script's list reply. Outbound adapter helper; it reads a reply and does no I/O.
import { Err, Ok, type Result } from "@flash/typekit";
import type { UnreadableReply } from "../../../application/ports/reply.js";

// The failure of a reply that a script does not write. Named once, so every Redis adapter says the same thing.
export const UNREADABLE: UnreadableReply = "unreadable_reply";

// Reads a script's list reply. Any other shape is a reply the script never writes, so it is a failure, and the store
// counts as unreadable.
export function arrayReply(reply: unknown): Result<unknown[], UnreadableReply> {
	if (!Array.isArray(reply)) return new Err(UNREADABLE);
	const parts: unknown[] = reply;
	return new Ok(parts);
}
