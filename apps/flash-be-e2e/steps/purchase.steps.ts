// Steps for the purchase: confirming a hold, what the confirmation answers (a purchase id, a refusal, a time), what a shopper's
// outcome is (purchased, still holding, or none), the payment (declined, slow, refunded), and an item another instance sold
// behind the API's back. Binds purchase/confirming.feature and purchase/outcome.feature. The hold itself is in
// reservation.steps.ts, and the calls every step uses are in support/shoppers.ts.

import { MS_PER_SECOND } from "@flash/flash-commons";
import type { APIRequestContext } from "@playwright/test";
import { expect } from "@playwright/test";
import { createBdd } from "playwright-bdd";
import { bodyOf, routes, send, TICKET_HEADER } from "./support/api.js";
import { shopperCookie, usernameKey } from "./support/auth.js";
import { query, SYSTEM_USER } from "./support/database.js";
import { currentResponse, setResponse } from "./support/response.js";
import { confirm, holdOf, postConfirm, shoppers } from "./support/shoppers.js";
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
	/^the payment provider takes (\d+) seconds$/,
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
		const users = Array.from(
			{ length: Number(count) },
			(_, i) => `shopper${i}`,
		);
		const replies = await Promise.all(
			users.map(async (user) => ({
				user,
				reply: await send(request, routes.reserve, {
					params: { saleId: currentSaleId() },
					headers: {
						cookie: await shopperCookie(request, user),
						[TICKET_HEADER]: shoppers().tickets.get(user) ?? "",
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

// Another instance sells the last item while this payment is still running. It is written to Postgres behind the API
// and Redis on purpose: a shopper going through the routes would wait as long as the slow payment of this scenario.
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
		await query("update sales set sold = stock where id = $1", [world.saleId]);
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

When(
	/^a client asks for the outcome of "([^"]+)"$/,
	async ({ request }, user: string) => {
		await outcome(request, user);
	},
);

When(
	/^a client asks for the outcome of "([^"]+)" in the sale with id "([^"]+)"$/,
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

// The refund is written to the API's log by the mock payment. The log is read until the line appears, for up to 3 seconds.
Then(
	/^the payment of "([^"]+)" is refunded$/,
	async ({ request: _request }, user: string) => {
		const line = `payment refunded: mock-${holdOf(user)?.reservationId}`;
		await pollUntil(async () => world.api?.log.includes(line) ?? false, {
			withinMs: 3000,
			everyMs: 50,
			failure: `no refund was written for ${user}`,
		});
		expect(world.api?.log).toContain(line);
	},
);
