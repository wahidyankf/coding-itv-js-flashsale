// Browser and server. The browser routes the web server passes on to the API, in the order the proxy checks them, and the
// two helpers that turn a route into a pattern or an address. The names come from the path table in @flash/flash-commons,
// so the page and the allow-list read the same paths. The operator routes are left out on purpose.
// Decision: docs/explanation/decisions/019-api-version-prefix.md.
import { API_PATHS } from "@flash/flash-commons";

// The methods the browser may use on a route. The proxy checks each one.
export type BrowserMethod = "GET" | "POST";

// The shopper's routes, each with its one method. `saleCurrent` comes before `sale`, because the sale-id pattern would
// otherwise match `/sales/current`. A shopper's own routes end in `/me`: who they are comes from the login cookie.
export const BROWSER_ROUTES: ReadonlyArray<readonly [BrowserMethod, string]> = [
	["POST", API_PATHS.authRegister],
	["POST", API_PATHS.authLogin],
	["POST", API_PATHS.authRefresh],
	["POST", API_PATHS.authLogout],
	["GET", API_PATHS.authMe],
	["GET", API_PATHS.saleCurrent],
	["GET", API_PATHS.sale],
	["GET", API_PATHS.saleEvents],
	["POST", API_PATHS.queue],
	["GET", API_PATHS.queueMe],
	["GET", API_PATHS.queueMeEvents],
	["POST", API_PATHS.reservations],
	["POST", API_PATHS.purchases],
	["GET", API_PATHS.purchaseMe],
];

// The placeholder a path template uses for the sale id.
const SALE_ID_PLACEHOLDER = ":saleId";

// The one pattern for a template: every character is literal except the sale id, which is one path segment. The
// pattern matches the whole path, so a longer path is not a route.
export function routePattern(template: string): RegExp {
	const escaped = template
		.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
		.replace(SALE_ID_PLACEHOLDER, "(?<saleId>[^/]+)");
	return new RegExp(`^${escaped}$`);
}

// The address of a route for one sale. The id is encoded, so an id cannot name another path.
export function fillSaleId(template: string, saleId: string): string {
	return template.replace(SALE_ID_PLACEHOLDER, encodeURIComponent(saleId));
}
