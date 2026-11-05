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

		async save(row) {
			if (repository.broken) throw new Error("postgres is unreachable");
			repository.rows.set(`${row.saleId}:${row.user}`, row);
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
