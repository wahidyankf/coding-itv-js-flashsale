// The reservation rows in memory for the unit layer (test support). The decision is the domain's, as the SQL adapter asks
// it; the rows and the failed write when Postgres is down are what this double adds.
import { attemptAsync } from "@flash/typekit";
import type { ReservationRepository } from "../../application/ports/reservation-repository.js";
import {
	decideReservation,
	type HoldSnapshot,
	type Reservation,
} from "../../domain/reservation.js";
import { isLive } from "../../domain/time.js";
import type { Username } from "../../domain/user.js";

// The reservation store of the unit layer. `broken` makes a save fail, as an unreachable Postgres does.
export type MemoryReservationRepository = ReservationRepository & {
	// While broken, saving a reservation fails, as when Postgres is unreachable.
	broken: boolean;
	rows: Map<string, Reservation>;
};

// The reservation rows in memory, for unit tests.
export function memoryReservationRepository(
	buyersOf: (saleId: string) => Username[] = () => [],
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

		// The same decision as the SQL: the domain's rule over the sold items and the live holds of the others.
		async reserveWithoutGate(request, gateReady) {
			const ready = await attemptAsync(gateReady, Error);
			if (ready.isOk() && ready.value) return { kind: "gate_ready" };
			const buyers = buyersOf(request.saleId);
			const own = repository.rows.get(`${request.saleId}:${request.user}`);
			const others = [...repository.rows.values()].filter(
				(row) =>
					row.saleId === request.saleId &&
					row.user !== request.user &&
					isLive(row, request.now),
			).length;
			const decision = decideReservation(
				{
					sold: buyers.length,
					purchased: buyers.includes(request.user),
					ownHold: own
						? { reservationId: own.reservationId, expiresAt: own.expiresAt }
						: undefined,
					othersHolding: others,
				},
				request,
			);
			if (decision.kind === "reserved") {
				repository.rows.set(`${request.saleId}:${request.user}`, {
					saleId: request.saleId,
					user: request.user,
					reservationId: request.reservationId,
					expiresAt: request.expiresAt,
				});
			}
			return decision;
		},

		async rebuild(saleId, now, restore) {
			const snapshot: HoldSnapshot = {
				buyers: buyersOf(saleId),
				holds: [...repository.rows.values()]
					.filter((row) => row.saleId === saleId && isLive(row, now))
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
