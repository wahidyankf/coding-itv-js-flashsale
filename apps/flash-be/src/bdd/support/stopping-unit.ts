// The shutdown steps' unit layer: the app over fake services on a real socket, and the real shutdown over it. No time
// passes on its own: the drain window and the payment are waits the world releases, so a step can check what the server
// does in between (readiness while it drains, a close that waits for the payment).
import { randomUUID } from "node:crypto";
import { MS_PER_HOUR } from "@flash/flash-commons";
import { sleep } from "@flash/flash-commons/timers";
import { Err, Ok } from "@flash/typekit";
import { expect } from "vitest";
import type { Dependencies } from "../../application/dependencies.js";
import type { Sale } from "../../domain/sale.js";
import { systemTimers } from "../../shutdown.js";
import type { StoppingWorld } from "./bind-health-shutdown.js";
import { healthyDeps } from "./deps.js";
import { fakeSale } from "./fake-sales.js";
import {
	deferred,
	type SaleStream,
	type StoppingServer,
	startStoppingServer,
	stoppingRequests,
	watchSale,
} from "./stopping-server.js";
import { usernameOf } from "./users.js";

// How long a step waits to see that the server is still closing, in milliseconds.
const STILL_CLOSING_MS = 30;

// The cookie of a shopper's login at the unit layer: the fake auth below reads the name back from it.
const cookieOf = (user: string) => `access_token=unit-${user}`;

// Fake services that answer a sale, a hold and a purchase. The purchase calls `paying` when the payment starts, and waits
// for `payment` before it answers.
function fakeShop(
	sale: () => Sale | undefined,
	payment: { paying: () => void; done: Promise<void> },
): Dependencies {
	return {
		...healthyDeps,
		sales: {
			...healthyDeps.sales,
			byId: async () => {
				const found = sale();
				return found && { sale: found, status: "active" as const };
			},
		},
		auth: {
			...healthyDeps.auth,
			authenticate: async (token) =>
				token?.startsWith("unit-")
					? new Ok({
							userId: randomUUID() as never,
							username: usernameOf(token.slice("unit-".length)),
							role: "shopper" as const,
						})
					: new Err("not_authenticated" as const),
		},
		reservations: {
			reserve: async (_saleId, user) =>
				new Ok({
					created: true,
					user,
					reservationId: randomUUID(),
					expiresAt: new Date(Date.now() + MS_PER_HOUR),
				}),
		},
		purchases: {
			...healthyDeps.purchases,
			confirm: async (saleId, user, reservationId) => {
				payment.paying();
				await payment.done;
				return new Ok({
					created: true,
					purchase: {
						id: randomUUID(),
						saleId,
						user,
						reservationId,
						paymentRef: `mock-${reservationId}`,
						purchasedAt: new Date(),
					},
				});
			},
		},
	};
}

// A new shutdown scenario at the unit layer.
export function unitStoppingWorld(): StoppingWorld {
	let sale: Sale | undefined;
	let drainMs = 0;
	const drain = deferred();
	const payment = deferred();
	const paying = deferred();
	const holds = new Map<string, string>();
	let server: StoppingServer | undefined;
	let stream: SaleStream | undefined;
	let confirmation: ReturnType<StoppingWorld["finishConfirm"]> | undefined;

	const running = async (): Promise<StoppingServer> => {
		server ??= await startStoppingServer({
			deps: fakeShop(() => sale, {
				paying: paying.resolve,
				done: payment.promise,
			}),
			drainMs,
			// The drain window ends when the world releases it; the time limit is real, and cleared when the shutdown ends.
			timers: { wait: () => drain.promise, schedule: systemTimers.schedule },
			stores: [],
		});
		return server;
	};
	const saleId = () => sale?.id ?? "";

	return {
		keepAnsweringFor: (seconds) => {
			drainMs = seconds;
		},
		start: async () => void (await running()),
		addSale: async ({ stock, sold }) => {
			sale = fakeSale({ stock, sold });
		},
		// The payment waits until the confirmation is let finish, whatever the seconds.
		setPaymentSeconds: () => {},
		admit: async () => {},
		reserve: async (user) => {
			const { origin } = await running();
			const reply = await stoppingRequests(origin).reserve(
				saleId(),
				cookieOf(user),
				"unit-ticket",
			);
			holds.set(user, String(reply.body.reservationId));
		},
		startConfirm: async (user) => {
			const { origin } = await running();
			confirmation = stoppingRequests(origin).confirm(
				saleId(),
				cookieOf(user),
				holds.get(user) ?? "",
			);
			await paying.promise;
		},
		finishConfirm: async () => {
			if (!confirmation || !server)
				throw new Error("no confirmation was started");
			// The drain window ends while the payment still runs: the server starts to close and must wait for it.
			drain.resolve();
			await server.closing;
			await sleep(STILL_CLOSING_MS);
			expect(server.exitCode()).toBeUndefined();
			payment.resolve();
			return confirmation;
		},
		watchSale: async () => {
			stream = await watchSale((await running()).origin, saleId());
		},
		askToStop: async () => (await running()).askToStop(),
		ready: async () => stoppingRequests((await running()).origin).ready(),
		streamEnded: async (withinMs) => {
			drain.resolve();
			return stream ? stream.ended(withinMs) : false;
		},
		exitCode: async (withinMs) => {
			drain.resolve();
			const exited = (await running()).exited;
			return Promise.race([
				exited,
				new Promise<undefined>((resolve) =>
					setTimeout(() => resolve(undefined), withinMs),
				),
			]);
		},
		close: async () => {
			stream?.close();
			drain.resolve();
			payment.resolve();
			await server?.exited;
		},
	};
}
