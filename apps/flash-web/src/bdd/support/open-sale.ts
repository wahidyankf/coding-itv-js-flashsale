// Step helper for the web scenarios: opens a sale in the scenario's world, from the phrases the scenario uses.
import { relativeTime } from "./time";
import type { WebWorld } from "./web-world";

// Opens a sale that the scenario describes with the phrases it uses, such as "1 hour ago" and "in 2 hours".
export async function openSale(
	world: WebWorld,
	stock: number,
	sold: number,
	opens: string,
	closes: string,
): Promise<void> {
	const at = world.now();
	await world.addSale({
		stock,
		sold,
		startsAt: relativeTime(opens, at),
		endsAt: relativeTime(closes, at),
	});
}
