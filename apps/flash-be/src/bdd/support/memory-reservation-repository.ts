import type { HoldSnapshot } from "../../reservations/hold-gate.js";
import type {
	ReservationRepository,
	ReservationRow,
} from "../../reservations/reservation-repository.js";

export type MemoryReservationRepository = ReservationRepository & {
	// While broken, saving a reservation fails, as when Postgres is unreachable.
	broken: boolean;
	rows: Map<string, ReservationRow>;
};

// The reservation rows in memory, for unit tests.
export function memoryReservationRepository(
	buyersOf: (saleId: string) => string[] = () => [],
): MemoryReservationRepository {
	const repository: MemoryReservationRepository = {
		broken: false,
		rows: new Map(),

		async hasPurchase(saleId, user) {
			return buyersOf(saleId).includes(user);
		},

		async save(row) {
			if (repository.broken) throw new Error("postgres is unreachable");
			repository.rows.set(`${row.saleId}:${row.user}`, row);
		},

		// The same rules as the SQL: sold items and live holds of other users count against the stock.
		async reserveWithoutRedis(request, redisReady) {
			if (await redisReady().catch(() => false)) {
				return { kind: "redis_ready" };
			}
			const buyers = buyersOf(request.saleId);
			if (buyers.includes(request.user)) return { kind: "purchased" };
			const own = repository.rows.get(`${request.saleId}:${request.user}`);
			if (own && own.expiresAt > request.now) {
				return {
					kind: "held",
					reservationId: own.reservationId,
					expiresAt: own.expiresAt,
				};
			}
			const live = [...repository.rows.values()].filter(
				(row) =>
					row.saleId === request.saleId &&
					row.user !== request.user &&
					row.expiresAt > request.now,
			).length;
			if (buyers.length + live >= request.stock) return { kind: "sold_out" };
			repository.rows.set(`${request.saleId}:${request.user}`, {
				saleId: request.saleId,
				user: request.user,
				reservationId: request.reservationId,
				expiresAt: request.expiresAt,
			});
			return {
				kind: "reserved",
				reservationId: request.reservationId,
				expiresAt: request.expiresAt,
			};
		},

		async rebuild(saleId, now, restore) {
			const snapshot: HoldSnapshot = {
				buyers: buyersOf(saleId),
				holds: [...repository.rows.values()]
					.filter((row) => row.saleId === saleId && row.expiresAt > now)
					.map((row) => ({
						user: row.user,
						reservationId: row.reservationId,
						expiresAt: row.expiresAt,
					})),
			};
			await restore(snapshot);
		},
	};
	return repository;
}
