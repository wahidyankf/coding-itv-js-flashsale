// The address of a sale route in the scenarios: a template from API_PATHS with the sale id filled in. The scenarios
// build every path from API_PATHS, so a renamed route reaches them with no literal to chase.
import { API_PATHS } from "@flash/flash-commons";

// A route of API_PATHS that names a sale.
type SaleRoute =
	| "sale"
	| "saleEvents"
	| "queue"
	| "queueMe"
	| "queueMeEvents"
	| "reservations"
	| "purchases"
	| "purchaseMe"
	| "adminSale";

// The path of a sale route for one sale. The id goes in as given, not encoded, so a scenario that sends an id which is
// not a UUID reaches the route exactly as the feature writes it.
export function salePath(route: SaleRoute, saleId: string): string {
	return API_PATHS[route].replace(":saleId", saleId);
}
