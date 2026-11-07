// The admission timer's one tick, for the sale shoppers are shown now (application layer). Every instance runs it; the queue
// store lets one instance win each tick, so the line moves at the sale's rate and not faster.
import type { QueueService } from "./queue-service.js";
import type { SaleService } from "./sale-service.js";

// One admission tick for the sale shoppers are shown now. Only that sale has a line that moves: a sale scheduled for
// later waits for its turn, and a sale that is over has nobody left to let in.
export async function admitCurrentSale(
	sales: Pick<SaleService, "current">,
	queue: Pick<QueueService, "admitTick">,
): Promise<void> {
	const current = await sales.current();
	if (current) await queue.admitTick(current.sale.id);
}
