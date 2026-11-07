// Kind: a shared failure value (not a port) for the Redis-backed ports. The failure a Redis-backed port reports when a
// reply cannot be read: the reply is not one the script writes. It is a value, so the service decides what it means
// (the store is treated as down). Application layer, port.
export type UnreadableReply = "unreadable_reply";
