import { type APIRequestContext, expect } from "@playwright/test";
import { createBdd } from "playwright-bdd";
import { shoppers } from "./queue.steps.js";
import { bodyOf, routes, send, TICKET_HEADER } from "./support/api.js";
import { shopperCookie } from "./support/auth.js";
import { currentResponse, setResponse } from "./support/response.js";
import { query, SYSTEM_USER, world } from "./support/world.js";

const { Given, When, Then } = createBdd();

type Request = APIRequestContext;

const key = (user: string) => user.trim().toLowerCase();

function holdOf(user: string) {
	return shoppers().holds.get(key(user));
}

async function post(
	request: Request,
	user: string,
	options: { reservationId?: string; owner?: string; saleId?: string } = {},
) {
	const reservationId =
		options.reservationId ?? holdOf(options.owner ?? user)?.reservationId;
	return send(request, routes.confirm, {
		params: { saleId: options.saleId ?? world.saleId ?? "" },
		headers: { cookie: await shopperCookie(request, user) },
		// A shopper with no hold sends no reservation id, which the API refuses.
		body: { reservationId: reservationId ?? "" },
	});
}

export async function confirm(
	request: Request,
	user: string,
	options: { reservationId?: string; owner?: string } = {},
) {
	const started = performance.now();
	const reply = await post(request, user, options);
	world.confirmMs = [...(world.confirmMs ?? []), performance.now() - started];
	setResponse(reply);
	const bought = await bodyOf(routes.confirm, reply);
	if (bought && !purchases().has(key(user))) purchases().set(key(user), bought);
}

function purchases() {
	return shoppers().purchases;
}

async function outcome(request: Request, user: string, saleId = world.saleId) {
	const reply = await send(request, routes.outcome, {
		params: { saleId: saleId ?? "" },
		headers: { cookie: await shopperCookie(request, user) },
	});
	setResponse(reply);
	return bodyOf(routes.outcome, reply);
}

Given(
	"the payment provider declines every payment",
	async ({ request: _request }) => {
		world.apiEnv = { ...world.apiEnv, PAYMENT_FAILURE_RATE: "1" };
	},
);

Given(
	/^the payment provider takes (\d+) seconds$/,
	async ({ request: _request }, seconds: string) => {
		world.apiEnv = {
			...world.apiEnv,
			PAYMENT_LATENCY_MS: String(Number(seconds) * 1000),
		};
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
					params: { saleId: world.saleId ?? "" },
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
	// biome-ignore lint/correctness/noEmptyPattern: playwright-bdd needs an object pattern as the first argument
	async ({}, limit: string) => {
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

When(
	/^"([^"]+)" starts to confirm the purchase$/,
	async ({ request }, user: string) => {
		world.pendingConfirm = post(request, user);
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
			holders.map((user) => post(request, user)),
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
			purchases().get(key(user))?.purchaseId,
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

Then(
	/^the payment of "([^"]+)" is refunded$/,
	async ({ request: _request }, user: string) => {
		const line = `payment refunded: mock-${holdOf(user)?.reservationId}`;
		const deadline = Date.now() + 3000;
		while (Date.now() < deadline && !world.api?.log.includes(line)) {
			await new Promise((resolve) => setTimeout(resolve, 50));
		}
		expect(world.api?.log).toContain(line);
	},
);
