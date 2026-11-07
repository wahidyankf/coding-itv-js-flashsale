// The sales that shoppers read, kept in Postgres. Reads only: an operator writes through the sale admin port.
import type { Sale } from "../../domain/sale.js";

export type SaleRepository = {
	// The sale with this id, or nothing when there is none.
	findById: (id: string) => Promise<Sale | undefined>;
	// The sale shoppers are shown at `now`: the one running, else the one that opens next, else none (see `pickCurrent`).
	findCurrent: (now: Date) => Promise<Sale | undefined>;
};
