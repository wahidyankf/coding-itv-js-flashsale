import type { Clock } from "../clock.js";
import type { Sale } from "./sale.js";
import type { SaleRepository } from "./sale-repository.js";

// The knob a scenario or the server turns. Zero turns the cache off.
export type SaleCacheSettings = { ttlMs: number };

type Entry = { sale: Sale; expiresAt: number };

// Keeps what the repository returned for `ttlMs`, so a crowd that watches the sale costs one read per interval and
// not one per shopper. Only reads go through it. A sale that is not found is not kept, so a sale created a moment
// later shows at once. A read that is already running is shared by the callers that arrive meanwhile.
export function createCachedSaleRepository(
	inner: SaleRepository,
	settings: SaleCacheSettings,
	clock: Clock,
): SaleRepository {
	const byId = new Map<string, Entry>();
	let current: Entry | undefined;
	const running = new Map<string, Promise<Sale | undefined>>();

	// Turning the cache off also drops what it kept, so turning it on again never serves an old row.
	const off = (): boolean => {
		if (settings.ttlMs > 0) return false;
		byId.clear();
		current = undefined;
		return true;
	};

	const fresh = (entry: Entry | undefined): Sale | undefined =>
		entry && entry.expiresAt > clock().getTime() ? entry.sale : undefined;

	const remember = (sale: Sale | undefined): Entry | undefined =>
		sale && { sale, expiresAt: clock().getTime() + settings.ttlMs };

	// One read at a time per key; later callers wait for it.
	const once = (
		key: string,
		read: () => Promise<Sale | undefined>,
	): Promise<Sale | undefined> => {
		const known = running.get(key);
		if (known) return known;
		const started = read().finally(() => running.delete(key));
		running.set(key, started);
		return started;
	};

	return {
		findById: async (id) => {
			if (off()) return inner.findById(id);
			const hit = fresh(byId.get(id));
			if (hit) return hit;
			const sale = await once(`id:${id}`, () => inner.findById(id));
			const entry = remember(sale);
			if (entry) byId.set(id, entry);
			return sale;
		},
		findCurrent: async () => {
			if (off()) return inner.findCurrent();
			const hit = fresh(current);
			if (hit) return hit;
			const sale = await once("current", () => inner.findCurrent());
			current = remember(sale);
			return sale;
		},
	};
}
