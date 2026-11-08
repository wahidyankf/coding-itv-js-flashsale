// The log of a rebuild of the sale gate from Postgres (outbound adapter). A rebuild means Redis lost a sale's state and
// reservations waited for it, so an operator wants to see when one starts, ends, or fails. composition.ts wraps the
// reservation repository with it; the reserve rules do not change.
import { attemptAsync } from "@flash/typekit";
import type { Logger } from "../../../application/ports/logger.js";
import type { ReservationRepository } from "../../../application/ports/reservation-repository.js";

// The same repository, with each rebuild logged with its sale: started and done at info, failed at warn. A failed
// rebuild still fails, so the caller handles it as before.
export function withRebuildLog(
	repository: ReservationRepository,
	log: Logger,
): ReservationRepository {
	return {
		...repository,
		rebuild: async (saleId, now, restore) => {
			log.info({ saleId }, "sale gate rebuild started");
			const rebuilt = await attemptAsync(
				() => repository.rebuild(saleId, now, restore),
				Error,
			);
			if (rebuilt.isErr()) {
				log.warn(
					{ saleId, cause: rebuilt.error.message },
					"sale gate rebuild failed",
				);
				throw rebuilt.error;
			}
			log.info({ saleId }, "sale gate rebuild done");
		},
	};
}
