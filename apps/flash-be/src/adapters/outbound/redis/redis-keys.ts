// The names of a sale's keys in Redis. Every key of one sale begins with `sale:<saleId>:`, so one builder makes all of
// them and a reader can find them with one pattern. Outbound Redis adapter.

// The key of one part of a sale's state, such as its buyers, its holds or its queue.
export const saleKey = (saleId: string, part: string): string =>
	`sale:${saleId}:${part}`;
