// A short in-process cache in front of the sale reads (application layer). It only answers reads for shoppers' pages;
// the rules that decide a write always read the sale fresh (see sale-service).
import type { Sale } from "../domain/sale.js";
import type { Clock } from "./ports/clock.js";
import type { SaleRepository } from "./ports/sale-repository.js";

// How long a read may be kept. Zero turns the cache off. The server reads it from the environment; a scenario turns it
// on and off while the app runs.
export type SaleCacheSettings = { ttlMs: number };

type Entry = { sale: Sale; expiresAt: number };

// Keeps what the repository returned for `ttlMs`, so a crowd of shoppers costs one read per interval, not one per shopper.
// A missing sale is not kept, so a sale created a moment later shows at once.
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
		sale === undefined
			? undefined
			: { sale, expiresAt: clock().getTime() + settings.ttlMs };

	// One read at a time per key; later callers wait for it.
	const once = (
		key: string,
		read: () => Promise<Sale | undefined>,
	): Promise<Sale | undefined> => {
		const known = running.get(key);
		if (known !== undefined) return known;
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
		findCurrent: async (now) => {
			if (off()) return inner.findCurrent(now);
			const hit = fresh(current);
			if (hit) return hit;
			const sale = await once("current", () => inner.findCurrent(now));
			current = remember(sale);
			return sale;
		},
	};
}
