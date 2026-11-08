// The API's route paths, written once. flash-be serves them, flash-web calls and proxies them, and the e2e apps, flash-load and
// the prod smoke script import them too, so a path is renamed here and nowhere else. The literal table in api-paths_tests.ts
// is the tripwire: a rename there is a visible, reviewed change. Part of the pure main entry.

// The prefix every API route is served under. A breaking change gets a new prefix, so the old one can stay for its clients.
export const API_PREFIX = "/api/v1";

// The base path of the auth routes. The refresh cookie is sent only under it, so the refresh token reaches the auth routes alone.
export const AUTH_BASE_PATH = `${API_PREFIX}/auth`;

// The probe paths. They stay at the root, outside the API prefix, because compose, nginx and the e2e configs check them there.
export const PROBE_PATHS = { health: "/health", ready: "/ready" } as const;

// Every API route, by a name that says what it does. A `:saleId` part is a placeholder that the route fills in.
export const API_PATHS = {
	// The sale a shopper sees now: the running sale, else the next one to open, else none.
	saleCurrent: `${API_PREFIX}/sales/current`,
	// One sale by its id.
	sale: `${API_PREFIX}/sales/:saleId`,
	// The live stream of one sale.
	saleEvents: `${API_PREFIX}/sales/:saleId/events`,
	// Joining the queue of a sale.
	queue: `${API_PREFIX}/sales/:saleId/queue`,
	// The place of the shopper who is logged in.
	queueMe: `${API_PREFIX}/sales/:saleId/queue/me`,
	// The live stream of the shopper's place.
	queueMeEvents: `${API_PREFIX}/sales/:saleId/queue/me/events`,
	// Holding one item of a sale.
	reservations: `${API_PREFIX}/sales/:saleId/reservations`,
	// Paying for a held item.
	purchases: `${API_PREFIX}/sales/:saleId/purchases`,
	// Whether the shopper who is logged in got the item, still holds it, or has nothing.
	purchaseMe: `${API_PREFIX}/sales/:saleId/purchases/me`,
	// Signing up a shopper.
	authRegister: `${AUTH_BASE_PATH}/register`,
	// Logging in.
	authLogin: `${AUTH_BASE_PATH}/login`,
	// Trading the refresh token for a new pair of tokens.
	authRefresh: `${AUTH_BASE_PATH}/refresh`,
	// Ending the login.
	authLogout: `${AUTH_BASE_PATH}/logout`,
	// Who the access cookie belongs to.
	authMe: `${AUTH_BASE_PATH}/me`,
	// The operator's list of sales, and the route that creates one.
	adminSales: `${API_PREFIX}/admin/sales`,
	// The operator's change and removal of one sale.
	adminSale: `${API_PREFIX}/admin/sales/:saleId`,
} as const;
