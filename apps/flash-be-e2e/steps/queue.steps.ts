// Steps for the queue: joining it, the ticket and place a shopper gets, the admission the API runs on its own timer, and the
// loss of the queue from Redis. Binds queue/joining.feature and queue/admission.feature. The join and check calls are in
// support/shoppers.ts, because other features use them too.

import { sleep } from "@flash/flash-commons/timers";
import { expect } from "@playwright/test";
import { createBdd } from "playwright-bdd";
import { bodyOf, routes } from "./support/api.js";
import { createSale, patchSale } from "./support/operator.js";
import { E2E_REDIS_URL, withRedis } from "./support/processes.js";
import { currentResponse } from "./support/response.js";
import { saleNow } from "./support/sale.js";
import {
	checkPlace,
	join,
	pollUntilAdmitted,
	shoppers,
	ticketOf,
} from "./support/shoppers.js";
import { relativeTime } from "./support/time.js";
import { currentSaleId } from "./support/world.js";

const { Given, When, Then } = createBdd();

// The scenario keeps talking about the running sale; the later one only has to exist.
Given(
	/^a later sale that opens (.+) and closes (.+)$/,
	async ({ request }, opens: string, closes: string) => {
		const now = new Date();
		await createSale(request, {
			stock: 10,
			startsAt: relativeTime(opens, now),
			endsAt: relativeTime(closes, now),
		});
	},
);

Given(
	/^the sale admits (\d+) users per second$/,
	async ({ request }, rate: string) => {
		await patchSale(request, currentSaleId(), {
			admitPerSecond: Number(rate),
		});
	},
);

When(/^"([^"]+)" joins the queue$/, async ({ request }, user: string) => {
	await join(request, user);
});

When(
	/^"([^"]+)" joins the queue of the sale with id "([^"]+)"$/,
	async ({ request }, user: string, saleId: string) => {
		await join(request, user, saleId);
	},
);

When(/^"([^"]+)" joins the queue again$/, async ({ request }, user: string) => {
	await join(request, user);
});

Given(/^"([^"]+)" has joined the queue$/, async ({ request }, user: string) => {
	await join(request, user);
});

Given(
	/^"([^"]+)", "([^"]+)" and "([^"]+)" have joined the queue in that order$/,
	async ({ request }, first: string, second: string, third: string) => {
		for (const user of [first, second, third]) await join(request, user);
	},
);

Given("the queue is lost", async ({ request: _request }) => {
	await withRedis(E2E_REDIS_URL, (redis) => redis.flushDb());
});

// The private API admits on its own timer. A sale that is open admits its first shopper within one tick, so wait for that.
// A sale that is not open admits nobody, so wait out a tick and a half instead.
When("admission runs once", async ({ request }) => {
	const sale = await bodyOf(routes.sale, await saleNow(request));
	const first = shoppers().joined[0];
	if (sale?.status !== "active" || !first) {
		await sleep(1500);
		return;
	}
	await pollUntilAdmitted(
		async () => (await checkPlace(request, first, ticketOf(first)))?.state,
		{
			withinMs: 5000,
			everyMs: 25,
			failure: "the queue admitted nobody in time",
		},
	);
});

When(
	/^"([^"]+)" checks the queue with their ticket$/,
	async ({ request }, user: string) => {
		await checkPlace(request, user, ticketOf(user));
	},
);

When(
	/^"([^"]+)" checks the queue with a wrong ticket$/,
	async ({ request }, user: string) => {
		await checkPlace(request, user, "not-the-ticket");
	},
);

Then(/^the user is "([^"]+)"$/, async ({ request: _request }, user: string) => {
	expect((await currentResponse().json()).userId).toBe(user);
});

Then("a ticket is issued", async ({ request: _request }) => {
	expect((await currentResponse().json()).ticket).toMatch(/^[\w-]{20,}$/);
});

Then(
	/^the place in line is (\d+)$/,
	async ({ request: _request }, place: string) => {
		expect((await currentResponse().json()).place).toBe(Number(place));
	},
);

Then(
	/^the place in line of "([^"]+)" is (\d+)$/,
	async ({ request }, user: string, place: string) => {
		const body = await checkPlace(request, user, ticketOf(user));
		expect(body?.state === "waiting" ? body.place : undefined).toBe(
			Number(place),
		);
	},
);

Then(
	/^the ticket is the one "([^"]+)" had before$/,
	async ({ request: _request }, user: string) => {
		expect((await currentResponse().json()).ticket).toBe(ticketOf(user));
	},
);

Then(/^"([^"]+)" is admitted$/, async ({ request }, user: string) => {
	const body = await checkPlace(request, user, ticketOf(user));
	expect(body?.state).toBe("admitted");
});

Then(
	/^"([^"]+)" is waiting at place (\d+)$/,
	async ({ request }, user: string, place: string) => {
		const body = await checkPlace(request, user, ticketOf(user));
		expect(body).toMatchObject({ state: "waiting", place: Number(place) });
	},
);
