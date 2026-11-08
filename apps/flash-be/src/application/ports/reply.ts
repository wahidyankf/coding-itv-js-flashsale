// Kind: a shared failure value, not a port. A Redis-backed port reports it when a reply is not one the script writes.
// It is a value, so the service decides what it means: the store counts as down. Application layer.
export type UnreadableReply = "unreadable_reply";
