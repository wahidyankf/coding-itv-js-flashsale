// Kind: repository (a record kept in Postgres, which survives a Redis outage). Application layer, port. The sales that
// shoppers read.
import type { Sale } from "../../domain/sale.js";

// Reads only, so a read cannot change a sale. Operators write through SaleAdmin.
export type SaleRepository = {
	// The sale with this id, or nothing when there is none.
	findById: (id: string) => Promise<Sale | undefined>;
	// The sale shoppers are shown at `now`: the one running, else the one that opens next, else none (see `pickCurrent`).
	findCurrent: (now: Date) => Promise<Sale | undefined>;
};
