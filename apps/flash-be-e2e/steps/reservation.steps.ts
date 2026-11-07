// Steps for the hold on an item: reserving it with a ticket, the hold's length, the rule that one shopper holds one item, the
// sold-out answer, a write that fails in Postgres, and the hold state lost from Redis. Binds reservation/reserving.feature
// and recovery/rebuild.feature. The reserve and waitUntilAdmitted calls are in support/shoppers.ts.

import { MS_PER_SECOND } from "@flash/flash-commons";
import { expect } from "@playwright/test";
import { createBdd } from "playwright-bdd";
import { errorOf } from "./support/api.js";
import { query } from "./support/database.js";
import { patchSale } from "./support/operator.js";
import { E2E_REDIS_URL, withRedis } from "./support/processes.js";
import { currentResponse } from "./support/response.js";
import {
	join,
	postReserve,
	reserve,
	shoppers,
	waitUntilAdmitted,
} from "./support/shoppers.js";
import { sleep } from "./support/time.js";
import { world } from "./support/world.js";

const { Given, When, Then } = createBdd();

// A trigger in the scenario's own database refuses every reservation write, the way a failing disk or a full table would.
// Dropping it lets writes through again.
Given(
	"Postgres refuses to save reservations",
	async ({ request: _request }) => {
		await query(`create function refuse_reservation() returns trigger language plpgsql as $$
	begin raise exception 'the write is refused'; end $$`);
		await query(`create trigger refuse_reservation before insert on reservations
	for each row execute function refuse_reservation()`);
	},
);

When("Postgres saves reservations again", async ({ request: _request }) => {
	await query("drop trigger refuse_reservation on reservations");
});

Given(/^"([^"]+)" has been admitted$/, async ({ request }, user: string) => {
	await join(request, user);
	await waitUntilAdmitted(request, [user]);
});

Given(
	/^(\d+) shoppers have been admitted$/,
	async ({ request }, count: string) => {
		const users = Array.from(
			{ length: Number(count) },
			(_, i) => `shopper${i}`,
		);
		for (const user of users) await join(request, user);
		await waitUntilAdmitted(request, users);
	},
);

Given(
	/^the hold time of the sale is (\d+) seconds?$/,
	async ({ request }, seconds: string) => {
		await patchSale(request, world.saleId ?? "", {
			holdSeconds: Number(seconds),
		});
	},
);

Given(/^"([^"]+)" has reserved an item$/, async ({ request }, user: string) => {
	await reserve(request, user);
});

Given(
	"the reservation state of the sale is lost from Redis",
	async ({ request: _request }) => {
		const names = ["ready", "buyers", "holds", "ids", "rebuild-lock"];
		await withRedis(E2E_REDIS_URL, (redis) =>
			redis.del(names.map((name) => `sale:${world.saleId}:${name}`)),
		);
	},
);

When(
	/^"([^"]+)" reserves an item and the write fails$/,
	async ({ request }, user: string) => {
		await reserve(request, user);
		expect(currentResponse().status()).toBe(500);
	},
);

When(/^"([^"]+)" reserves an item$/, async ({ request }, user: string) => {
	await reserve(request, user);
});

When(
	/^"([^"]+)" reserves an item with a wrong ticket$/,
	async ({ request }, user: string) => {
		await reserve(request, user, { ticket: "not-the-ticket" });
	},
);

When(
	/^"([^"]+)" reserves an item in the sale with id "([^"]+)"$/,
	async ({ request }, user: string, saleId: string) => {
		await reserve(request, user, { saleId });
	},
);

When(
	/^(\d+) seconds? pass$/,
	async ({ request: _request }, seconds: string) => {
		await sleep(Number(seconds) * MS_PER_SECOND + 200);
	},
);

// Every shopper asks at once. The answers are kept with their error codes, for the counting steps.
When(
	/^all (\d+) shoppers reserve an item at the same time$/,
	async ({ request }, count: string) => {
		const users = Array.from(
			{ length: Number(count) },
			(_, i) => `shopper${i}`,
		);
		const replies = await Promise.all(
			users.map((user) => postReserve(request, user)),
		);
		shoppers().replies = await Promise.all(
			replies.map(async (reply) => ({
				status: reply.status(),
				error: await errorOf(reply),
			})),
		);
	},
);

Then("a reservation id is issued", async ({ request: _request }) => {
	expect((await currentResponse().json()).reservationId).toMatch(
		/^[0-9a-f-]{36}$/,
	);
});

Then(
	/^the hold ends in (\d+) seconds$/,
	async ({ request: _request }, seconds: string) => {
		const ends = new Date((await currentResponse().json()).expiresAt).getTime();
		expect(
			Math.abs(ends - Date.now() - Number(seconds) * MS_PER_SECOND),
		).toBeLessThan(5000);
	},
);

Then(
	/^the reservation is the one "([^"]+)" had before$/,
	async ({ request: _request }, user: string) => {
		expect((await currentResponse().json()).reservationId).toBe(
			shoppers().holds.get(user)?.reservationId,
		);
	},
);

Then(
	/^(\d+) reservations are granted$/,
	async ({ request: _request }, count: string) => {
		expect(
			shoppers().replies.filter((reply) => reply.status === 201),
		).toHaveLength(Number(count));
	},
);

Then(
	/^(\d+) shoppers are told the item is sold out$/,
	async ({ request: _request }, count: string) => {
		const soldOut = shoppers().replies.filter(
			(reply) => reply.status === 409 && reply.error === "sold_out",
		);
		expect(soldOut).toHaveLength(Number(count));
	},
);
