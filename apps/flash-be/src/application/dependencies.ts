import type { AuthService } from "./auth-service.js";
import type { PurchaseService } from "./purchase-service.js";
import type { QueueService } from "./queue-service.js";
import type { RateLimiter } from "./rate-limiter.js";
import type { ReservationService } from "./reservation-service.js";
import type { SaleAdminService } from "./sale-admin-service.js";
import type { SaleService } from "./sale-service.js";

// Everything a driving adapter (HTTP) needs from the application. It is injected, so unit tests can fake it without a
// real database or Redis.
export type Dependencies = {
	checkDatabase: () => Promise<void>;
	checkRedis: () => Promise<void>;
	auth: AuthService;
	sales: SaleService;
	admin: SaleAdminService;
	queue: QueueService;
	reservations: ReservationService;
	purchases: PurchaseService;
	rateLimiter: RateLimiter;
};
