// What the HTTP adapter needs from the application, in one object (application layer, the wiring's hand-off). It is
// injected, so a unit test can fake any part without a real database or Redis.
import type { AuthService } from "./auth-service.js";
import type { PurchaseService } from "./purchase-service.js";
import type { QueueService } from "./queue-service.js";
import type { RateLimiter } from "./rate-limiter.js";
import type { ReservationService } from "./reservation-service.js";
import type { SaleAdminService } from "./sale-admin-service.js";
import type { SaleCacheSettings } from "./sale-cache.js";
import type { SaleService } from "./sale-service.js";

// Everything the driving adapter (HTTP) calls. The two health checks are here too, so `/health` and `/ready` never
// reach into a store themselves. `saleCache` is the cache the sale reads use, held by reference: the route reads its time
// for the cache header, so a change made while the app runs shows at once.
export type Dependencies = {
	checkDatabase: () => Promise<void>;
	checkGate: () => Promise<void>;
	auth: AuthService;
	sales: SaleService;
	saleCache: SaleCacheSettings;
	admin: SaleAdminService;
	queue: QueueService;
	reservations: ReservationService;
	purchases: PurchaseService;
	rateLimiter: RateLimiter;
};
