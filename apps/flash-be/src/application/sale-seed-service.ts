// The seed use case: the seed command stores a sale without the overlap check an operator's create makes, and gets the
// sale back as the domain builds it. The command is the only caller; the store is the SaleSeeder port.
import type { Sale } from "../domain/sale.js";
import { type NewSale, newSale } from "../domain/sale-window.js";
import type { UserId } from "../domain/user.js";
import type { SaleSeeder } from "./ports/sale-seeder.js";

// The seed use case, for the seed command only. It stores the sale without the overlap check an operator's create makes.
export type SaleSeedService = {
	// Stores the sale and returns it with its id and product. Overlap is not checked here.
	seed: (input: NewSale, actor: UserId) => Promise<Sale>;
};

// Builds the seed use case over a SaleSeeder. The domain rebuilds the sale from the stored ids, so the caller gets the sale
// the domain would make.
export function createSaleSeedService(seeder: SaleSeeder): SaleSeedService {
	return {
		seed: async (input, actor) => {
			const stored = await seeder.seed(input, actor);
			return newSale({ ...input, ...stored });
		},
	};
}
