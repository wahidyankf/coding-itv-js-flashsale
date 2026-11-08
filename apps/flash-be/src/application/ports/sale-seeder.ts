// Kind: a plain port (no suffix). Application layer. Seeds a sale for the demo and the tests. It skips the overlap check
// that an operator's create makes.
import type { NewSale } from "../../domain/sale-window.js";
import type { UserId } from "../../domain/user.js";

// The seed command's one write. It skips the overlap check, which is why only the demo and the tests reach it.
export type SaleSeeder = {
	// Stores the sale and returns its id and its product. The rows are written in one transaction.
	seed: (
		sale: NewSale,
		actor: UserId,
	) => Promise<{ id: string; productId: string }>;
};
