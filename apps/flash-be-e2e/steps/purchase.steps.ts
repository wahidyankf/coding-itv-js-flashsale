// Steps for the purchase: confirming a hold, what the confirmation answers (a purchase id, a refusal, a time), what a shopper's
// outcome is (purchased, still holding, or none), the payment (declined, slow, charged once, refunded, as the ledger holds
// it), and an item that another instance sold.
// Binds purchase/confirming.feature and purchase/outcome.feature. The hold itself is in
// reservation.steps.ts, and the calls every step uses are in support/shoppers.ts.

import { MS_PER_SECOND } from "@flash/flash-commons";
import type { APIRequestContext } from "@playwright/test";
import { expect } from "@playwright/test";
import { createBdd } from "playwright-bdd";
import { bodyOf, routes, send, TICKET_HEADER } from "./support/api.js";
import { shopperCookie, usernameKey } from "./support/auth.js";
import { query, SYSTEM_USER, sellOut } from "./support/database.js";
import { currentResponse, setResponse } from "./support/response.js";
import {
	confirm,
	holdOf,
	postConfirm,
	shopperNames,
	shoppers,
	ticketOf,
} from "./support/shoppers.js";
import { pollUntil } from "./support/time.js";
import { currentSaleId, setApiEnv, world } from "./support/world.js";

const { Given, When, Then } = createBdd();

// The outcome a shopper has in the sale: purchased, holding an item, or none. Keeps the reply for the steps after it.
async function outcome(
	request: APIRequestContext,
	user: string,
	saleId = currentSaleId(),
) {
	const reply = await send(request, routes.outcome, {
		params: { saleId },
		headers: { cookie: await shopperCookie(request, user) },
	});
	setResponse(reply);
	return bodyOf(routes.outcome, reply);
}

Given(
	"the payment provider declines every payment",
	async ({ request: _request }) => {
		setApiEnv({ PAYMENT_FAILURE_RATE: "1" });
	},
);

Given(
	/^the payment provider takes (\d+) seconds?$/,
	async ({ request: _request }, seconds: string) => {
		setApiEnv({ PAYMENT_LATENCY_MS: String(Number(seconds) * MS_PER_SECOND) });
	},
);

Given(
	/^"([^"]+)" has confirmed the purchase$/,
	async ({ request }, user: string) => {
		await confirm(request, user);
	},
);

Given(
	/^all (\d+) shoppers have tried to reserve an item$/,
	async ({ request }, count: string) => {
		const users = shopperNames(Number(count));
		const replies = await Promise.all(
			users.map(async (user) => ({
				user,
				reply: await send(request, routes.reserve, {
					params: { saleId: currentSaleId() },
					headers: {
						cookie: await shopperCookie(request, user),
						[TICKET_HEADER]: ticketOf(user) ?? "",
					},
				}),
			})),
		);
		for (const { user, reply } of replies) {
			const held = await bodyOf(routes.reserve, reply);
			if (reply.status() === 201 && held) shoppers().holds.set(user, held);
		}
	},
);

When(/^"([^"]+)" confirms the purchase$/, async ({ request }, user: string) => {
	await confirm(request, user);
});

Then(
	/^every confirmation answered in less than (\d+) milliseconds$/,
	async ({ request: _request }, limit: string) => {
		const times = world.confirmMs ?? [];
		expect(times).toHaveLength(3);
		expect(Math.max(...times)).toBeLessThan(Number(limit));
	},
);

When(
	/^"([^"]+)" confirms the purchase with the reservation id "([^"]*)"$/,
	async ({ request }, user: string, reservationId: string) => {
		await confirm(request, user, { reservationId });
	},
);

When(
	/^"([^"]+)" confirms the purchase with the reservation of "([^"]+)"$/,
	async ({ request }, user: string, owner: string) => {
		await confirm(request, user, { owner });
	},
);

// A body that names no reservation at all, which a client with nothing held might send.
When(
	/^"([^"]+)" confirms the purchase with an empty body$/,
	async ({ request }, user: string) => {
		setResponse(
			await send(request, routes.confirm, {
				params: { saleId: currentSaleId() },
				headers: { cookie: await shopperCookie(request, user) },
				body: {},
			}),
		);
	},
);

// The sale's end comes while the shopper still holds an item: its window is closed in the scenario's database.
Given("the sale has ended", async ({ request: _request }) => {
	await query(
		"update sales set ends_at = now() - interval '1 second' where id = $1",
		[currentSaleId()],
	);
});

// Starts a confirmation and does not wait for it, so a later step can let another purchase go first.
When(
	/^"([^"]+)" starts to confirm the purchase$/,
	async ({ request }, user: string) => {
		world.pendingConfirm = postConfirm(request, user);
	},
);

When("the confirmation finishes", async ({ request: _request }) => {
	if (!world.pendingConfirm) throw new Error("no confirmation was started");
	setResponse(await world.pendingConfirm);
});

// Another instance sells the last item while this payment is still running. It is written to Postgres and Redis directly, not through the API:
// a shopper going through the routes would wait for this scenario's slow payment.
When(
	/^"([^"]+)" buys the last item$/,
	async ({ request: _request }, user: string) => {
		await query(
			`with buyer as (
			   insert into users (username, created_by) values ($2, ${SYSTEM_USER})
			   on conflict (username) where deleted_at is null do update set username = excluded.username
			   returning id
			 )
			 insert into purchases (sale_id, user_id, reservation_id, payment_ref, created_by)
			 select $1, buyer.id, gen_random_uuid(), $3, buyer.id from buyer`,
			[world.saleId, user, `pay-${user}`],
		);
		await sellOut(currentSaleId());
	},
);

When(
	"every shopper who holds an item confirms the purchase at the same time",
	async ({ request }) => {
		const holders = [...shoppers().holds.keys()];
		const replies = await Promise.all(
			holders.map((user) => postConfirm(request, user)),
		);
		shoppers().replies = replies.map((reply) => ({ status: reply.status() }));
	},
);

When(/^"([^"]+)" asks for the outcome$/, async ({ request }, user: string) => {
	await outcome(request, user);
});

When(
	/^"([^"]+)" asks for the outcome in the sale with id "([^"]+)"$/,
	async ({ request }, user: string, saleId: string) => {
		await outcome(request, user, saleId);
	},
);

Then("a purchase id is issued", async ({ request: _request }) => {
	expect((await currentResponse().json()).purchaseId).toMatch(
		/^[0-9a-f-]{36}$/,
	);
});

Then(
	/^the purchase is the one "([^"]+)" had before$/,
	async ({ request: _request }, user: string) => {
		expect((await currentResponse().json()).purchaseId).toBe(
			shoppers().purchases.get(usernameKey(user))?.purchaseId,
		);
	},
);

Then(
	/^the outcome state is "([^"]+)"$/,
	async ({ request: _request }, state: string) => {
		expect((await currentResponse().json()).state).toBe(state);
	},
);

Then(/^"([^"]+)" still holds the item$/, async ({ request }, user: string) => {
	expect((await outcome(request, user))?.state).toBe("holding");
});

Then(/^"([^"]+)" has no purchase$/, async ({ request }, user: string) => {
	expect((await outcome(request, user))?.state).toBe("none");
});

Then(
	/^(\d+) purchases are made$/,
	async ({ request: _request }, count: string) => {
		expect(
			shoppers().replies.filter((reply) => reply.status === 201),
		).toHaveLength(Number(count));
	},
);

// The mock payment's ledger row of the shopper's first hold, as the scenario's database holds it (decision 009).
async function paymentOf(user: string) {
	const rows = await query<{ status: string; ref: string; attempts: number }>(
		"select status, ref, attempts from payments where reservation_id = $1",
		[holdOf(user)?.reservationId],
	);
	return rows[0];
}

// The refund is written to the ledger by the mock payment. The row is read until it says so, for up to 3 seconds.
Then(
	/^the payment of "([^"]+)" is refunded$/,
	async ({ request: _request }, user: string) => {
		await pollUntil(
			async () => (await paymentOf(user))?.status === "refunded",
			{
				withinMs: 3000,
				everyMs: 50,
				failure: `no refund was written for ${user}`,
			},
		);
	},
);

Then(
	/^the payment of "([^"]+)" was charged once and refunded once$/,
	async ({ request: _request }, user: string) => {
		expect(await paymentOf(user)).toEqual({
			status: "refunded",
			ref: expect.stringMatching(/^mock-/),
			attempts: 1,
		});
	},
);

Then(
	/^the payment of "([^"]+)" is charged once$/,
	async ({ request: _request }, user: string) => {
		expect(await paymentOf(user)).toEqual({
			status: "charged",
			ref: expect.stringMatching(/^mock-/),
			attempts: 1,
		});
	},
);

Then(
	/^the payment of "([^"]+)" is charged on the second attempt$/,
	async ({ request: _request }, user: string) => {
		expect(await paymentOf(user)).toEqual({
			status: "charged",
			ref: expect.stringMatching(/^mock-/),
			attempts: 2,
		});
	},
);

// The new setting starts a new API process over the same database, so the retry runs on another instance than the
// decline did, and finds the decline in the shared ledger.
Given(
	"the payment provider accepts every payment",
	async ({ request: _request }) => {
		setApiEnv({ PAYMENT_FAILURE_RATE: "0" });
	},
);

Given(
	/^"([^"]+)" has tried to confirm the purchase and was declined$/,
	async ({ request }, user: string) => {
		await confirm(request, user);
		expect(currentResponse().status()).toBe(402);
	},
);

// This layer runs one API process, so both confirmations reach the same instance at once. The proof across two
// instances is the integration binding, where two mock payments share one ledger in Postgres.
When(
	/^"([^"]+)" confirms the purchase on two instances at the same time$/,
	async ({ request }, user: string) => {
		const replies = await Promise.all([
			postConfirm(request, user),
			postConfirm(request, user),
		]);
		shoppers().replies = await Promise.all(
			replies.map(async (reply) => ({
				status: reply.status(),
				purchaseId: (await bodyOf(routes.confirm, reply))?.purchaseId,
			})),
		);
	},
);

// One confirmation writes the purchase (201) and the other gets it back as a repeat (200), whichever is first.
Then(
	"both confirmations answer with the same purchase",
	async ({ request: _request }) => {
		const [first, second] = shoppers().replies;
		expect(
			shoppers()
				.replies.map((reply) => reply.status)
				.sort(),
		).toEqual([200, 201]);
		expect(first?.purchaseId).toEqual(expect.any(String));
		expect(second?.purchaseId).toBe(first?.purchaseId);
	},
);
