// Two instances of the API for the scenarios that confirm one hold twice at once: the payment of each layer, built twice
// over one ledger, and the request that sends the same confirmation to both. A real deployment runs several instances
// behind nginx, and only a shared ledger keeps them from charging twice (decision 009).

import type { FastifyInstance } from "fastify";
import { createMemoryPaymentLedger } from "../../adapters/outbound/memory/memory-payment-ledger.js";
import {
	createMockPayment,
	type MockPayment,
} from "../../adapters/outbound/payment/mock-payment.js";
import type { PaymentLedger } from "../../adapters/outbound/payment/payment-ledger.js";
import type { MemoryPurchaseRepository } from "./memory-purchase-repository.js";
import { shopperKey } from "./queue-requests.js";
import type { Response, ShopScenario } from "./queue-scenario.js";
import { salePath } from "./sale-path.js";

// The payments of two instances over one ledger. Latency and declines start at zero, so only a scenario that asks for
// them meets them; `sleep` is the layer's way to wait.
export function twoPayments(
	ledger: PaymentLedger,
	sleep?: (ms: number) => Promise<void>,
): [MockPayment, MockPayment] {
	const make = () =>
		createMockPayment({
			ledger,
			latencyMs: 0,
			failureRate: 0,
			...(sleep === undefined ? {} : { sleep }),
		});
	return [make(), make()];
}

// Changes the provider's settings on every instance at once, as one setting of a deployment would.
export function setProvider(
	payments: MockPayment[],
	change: Partial<MockPayment["settings"]>,
): void {
	for (const payment of payments) Object.assign(payment.settings, change);
}

// The payments of the unit layer: a ledger in memory and the purchases in memory, each told about the other as the
// Postgres tables are, and a wait that only the scenario's clock ends. `timers` holds the waits until the clock passes
// them.
export function unitPayments(
	now: () => Date,
	timers: Array<{ at: number; resolve: () => void }>,
	purchased: Pick<MemoryPurchaseRepository, "purchases" | "chargeIsLive">,
): [MockPayment, MockPayment] {
	const ledger = createMemoryPaymentLedger({
		heldByPurchase: (ref) =>
			purchased.purchases.some((purchase) => purchase.paymentRef === ref),
	});
	purchased.chargeIsLive = ledger.isCharged;
	return twoPayments(ledger, (ms) =>
		ms <= 0
			? Promise.resolve()
			: new Promise((resolve) => {
					timers.push({ at: now().getTime() + ms, resolve });
				}),
	);
}

// The other confirmation of the same hold gave up and refunded the shared charge, and its refund lands between this
// confirmation's charge and its commit: the next charge of `payment` is refunded as soon as it is made. Only that charge.
export function giveBackNextCharge(payment: MockPayment): void {
	const charge = payment.charge;
	payment.charge = async (reservationId) => {
		payment.charge = charge;
		const charged = await charge(reservationId);
		if (charged.isOk()) await payment.refund(charged.value.ref);
		return charged;
	};
}

// The shopper's confirmation of their hold, sent to both instances at the same moment. Both replies are kept in
// `scenario.replies`, in the order of the instances.
export async function confirmOnBoth(
	apps: [FastifyInstance, FastifyInstance],
	scenario: ShopScenario,
	user: string,
): Promise<Response[]> {
	const cookie = await scenario.login(user);
	const reservationId = scenario.holds.get(shopperKey(user))?.reservationId;
	scenario.replies = await Promise.all(
		apps.map((app) =>
			app.inject({
				method: "POST",
				url: salePath("purchases", scenario.saleId),
				headers: { cookie },
				payload: { reservationId },
			}),
		),
	);
	return scenario.replies;
}
