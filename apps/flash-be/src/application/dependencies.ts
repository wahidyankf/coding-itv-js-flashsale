// What the HTTP adapter needs from the application, in one object (application layer). The wiring passes it in, so a
// unit test can fake any part without a real database or Redis.
import type { AuthService } from "./auth-service.js";
import type { PurchaseService } from "./purchase-service.js";
import type { QueueService } from "./queue-service.js";
import type { RateLimiter } from "./rate-limiter.js";
import type { ReservationService } from "./reservation-service.js";
import type { SaleAdminService } from "./sale-admin-service.js";
import type { SaleCacheSettings } from "./sale-cache.js";
import type { SaleService } from "./sale-service.js";

// Everything the HTTP adapter calls. The health checks are here too, so `/health` and `/ready` reach no store directly.
// `saleCache` is held by reference, so a change to it shows at once; the route reads its time for the cache header.
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
