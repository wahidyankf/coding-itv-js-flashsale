// The shoppers of a scenario and the calls they make on the way to a purchase: join the queue, check the place, hold an
// item, and confirm the purchase. Several step files use them, so they live here. Each call keeps what the API answered,
// so the steps that come after it can read it.

import type { APIRequestContext } from "@playwright/test";
import { bodyOf, routes, send, TICKET_HEADER } from "./api.js";
import { shopperCookie, usernameKey } from "./auth.js";
import { setResponse } from "./response.js";
import { pollUntil } from "./time.js";
import { currentSaleId, type ShopperState, world } from "./world.js";

// How long the whole group of shoppers may take to be admitted, counted from the first check.
const GROUP_ADMISSION_WAIT_MS = 8000;

// The shoppers' state of this scenario, made on first use.
export function shoppers(): ShopperState {
	world.queue ??= {
		tickets: new Map(),
		joined: [],
		holds: new Map(),
		purchases: new Map(),
		replies: [],
	};
	return world.queue;
}

// The hold of a shopper, as the API last gave it, or undefined when the shopper holds nothing.
export function holdOf(user: string) {
	return shoppers().holds.get(usernameKey(user));
}

// The ticket the shopper was issued in this scenario, or undefined when the shopper has not joined. Tickets are kept by
// usernameKey, so the lookup applies it too: a name typed in another case finds the same ticket.
export function ticketOf(user: string): string | undefined {
	return shoppers().tickets.get(usernameKey(user));
}

// The names of the first `count` shoppers, shopper0 up to shopper{count - 1}. A step that queues or holds a crowd names
// them with this, so every scenario's crowd is the same set of shoppers.
export function shopperNames(count: number): string[] {
	return Array.from({ length: count }, (_, i) => `shopper${i}`);
}

// Joins the queue of the sale (the running one by default). The ticket is kept the first time only.
export async function join(
	request: APIRequestContext,
	user: string,
	saleId = currentSaleId(),
) {
	const reply = await send(request, routes.joinQueue, {
		params: { saleId },
		headers: { cookie: await shopperCookie(request, user) },
	});
	setResponse(reply);
	const joined = await bodyOf(routes.joinQueue, reply);
	const held = shoppers();
	const key = usernameKey(user);
	if (joined && !held.tickets.has(key)) {
		held.tickets.set(key, joined.ticket);
		held.joined.push(key);
	}
}

// Asks for a place in the queue, with the ticket given or the one the shopper was issued. Returns the place when the API
// gave one, and nothing when it refused.
export async function checkPlace(
	request: APIRequestContext,
	user: string,
	ticket?: string,
) {
	const reply = await send(request, routes.checkPlace, {
		params: { saleId: currentSaleId() },
		headers: {
			cookie: await shopperCookie(request, user),
			[TICKET_HEADER]: ticket,
		},
	});
	setResponse(reply);
	return bodyOf(routes.checkPlace, reply);
}

// Sends the request that holds an item, with the shopper's ticket unless another one is given, and returns the reply
// without keeping it. Use reserve to keep the hold.
export async function postReserve(
	request: APIRequestContext,
	user: string,
	options: { ticket?: string; saleId?: string } = {},
) {
	const ticket = options.ticket ?? ticketOf(user);
	return send(request, routes.reserve, {
		params: { saleId: options.saleId ?? currentSaleId() },
		headers: {
			cookie: await shopperCookie(request, user),
			[TICKET_HEADER]: ticket,
		},
	});
}

// Holds an item for the shopper and keeps the hold, unless the shopper already has one.
export async function reserve(
	request: APIRequestContext,
	user: string,
	options: { ticket?: string; saleId?: string } = {},
) {
	const reply = await postReserve(request, user, options);
	setResponse(reply);
	const key = usernameKey(user);
	const held = await bodyOf(routes.reserve, reply);
	if (held && !shoppers().holds.has(key)) shoppers().holds.set(key, held);
}

// Waits until the queue admits a shopper. `readState` reads the state of the shopper's place (such as "waiting" or
// "admitted") each time it is called. Fails with `failure` when the time runs out. Every admission wait of the e2e apps
// goes through here, so they all wait for the same state.
export function pollUntilAdmitted(
	readState: () => Promise<string | undefined>,
	options: { withinMs: number; everyMs: number; failure: string },
): Promise<void> {
	return pollUntil(async () => (await readState()) === "admitted", options);
}

// The admission runs on the API's own timer, so a shopper who joined is admitted within one or two admission ticks. Waits until every
// shopper is admitted, and fails the step when one is still waiting after the time limit.
export async function waitUntilAdmitted(
	request: APIRequestContext,
	users: string[],
) {
	const deadline = Date.now() + GROUP_ADMISSION_WAIT_MS;
	for (const user of users) {
		await pollUntilAdmitted(
			async () => (await checkPlace(request, user, ticketOf(user)))?.state,
			{
				withinMs: deadline - Date.now(),
				everyMs: 50,
				failure: `${user} was not admitted in time`,
			},
		);
	}
}

// Sends the request that confirms the purchase. The hold is the shopper's own, unless `owner` names another shopper or
// `reservationId` gives one directly. A shopper with no hold sends an empty id, which the API refuses.
export async function postConfirm(
	request: APIRequestContext,
	user: string,
	options: { reservationId?: string; owner?: string } = {},
) {
	const reservationId =
		options.reservationId ?? holdOf(options.owner ?? user)?.reservationId;
	return send(request, routes.confirm, {
		params: { saleId: currentSaleId() },
		headers: { cookie: await shopperCookie(request, user) },
		body: { reservationId: reservationId ?? "" },
	});
}

// Confirms the purchase and keeps the answer. It keeps the purchase too, unless the shopper already has one, and records the time for the speed scenarios.
export async function confirm(
	request: APIRequestContext,
	user: string,
	options: { reservationId?: string; owner?: string } = {},
) {
	const started = performance.now();
	const reply = await postConfirm(request, user, options);
	world.confirmMs = [...(world.confirmMs ?? []), performance.now() - started];
	setResponse(reply);
	const bought = await bodyOf(routes.confirm, reply);
	const key = usernameKey(user);
	if (bought && !shoppers().purchases.has(key))
		shoppers().purchases.set(key, bought);
}
