// The admission timer's one tick, for the sale shoppers are shown now. Every instance runs it; the queue store lets one
// instance win each tick, so the line moves at the sale's rate and not faster.
import type { QueueService } from "./queue-service.js";
import type { SaleService } from "./sale-service.js";

// One admission tick for the sale shoppers are shown now. Only that sale has a line that moves: a sale scheduled for
// later waits for its turn, and a sale that is over has nobody left to let in.
export async function admitCurrentSale(
	sales: Pick<SaleService, "current">,
	queue: Pick<QueueService, "admitTick">,
): Promise<void> {
	const sale = await sales.current();
	if (sale) await queue.admitTick(sale.id);
}
