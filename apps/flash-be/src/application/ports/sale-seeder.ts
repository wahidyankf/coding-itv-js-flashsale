// Kind: a plain port (no suffix). Seeding a sale for the demo and the tests. It is the one write that skips the overlap
// check an operator's create makes: the seed command does not check overlap, and the operator routes do.
import type { NewSale } from "../../domain/sale-window.js";
import type { UserId } from "../../domain/user.js";

export type SaleSeeder = {
	// Stores the sale and returns its id and its product. The rows are written in one transaction.
	seed: (
		sale: NewSale,
		actor: UserId,
	) => Promise<{ id: string; productId: string }>;
};
