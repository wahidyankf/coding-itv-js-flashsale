import { expect } from "@playwright/test";
import { createBdd } from "playwright-bdd";
import { createClient } from "redis";
import { check, join, shoppers } from "./queue.steps.js";
import { currentResponse, setResponse } from "./support/response.js";
import { E2E_REDIS_URL, query, startApi, world } from "./support/world.js";

const { Given, When, Then } = createBdd();

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type Request = Parameters<typeof join>[0];

async function post(
	request: Request,
	user: string,
	options: { ticket?: string; saleId?: string } = {},
) {
	const url = await startApi();
	const key = user.trim().toLowerCase();
	const ticket = options.ticket ?? shoppers().tickets.get(key);
	const reply = await request.post(
		`${url}/sales/${options.saleId ?? world.saleId}/reservations`,
		{
			data: { userId: user },
			headers: ticket === undefined ? {} : { "x-queue-ticket": ticket },
		},
	);
	return reply;
}

export async function reserve(
	request: Request,
	user: string,
	options: { ticket?: string; saleId?: string } = {},
) {
	const reply = await post(request, user, options);
	setResponse(reply);
	const key = user.trim().toLowerCase();
	if (
		(reply.status() === 201 || reply.status() === 200) &&
		!shoppers().holds.has(key)
	) {
		shoppers().holds.set(key, await reply.json());
	}
}

// The private API admits on its own timer, so a shopper who just joined is admitted within a tick or two.
async function waitUntilAdmitted(request: Request, users: string[]) {
	const deadline = Date.now() + 8000;
	for (const user of users) {
		const key = user.trim().toLowerCase();
		for (;;) {
			const body = await check(request, key, shoppers().tickets.get(key));
			if (body.state === "admitted") break;
			if (Date.now() > deadline)
				throw new Error(`${user} was not admitted in time`);
			await sleep(50);
		}
	}
}

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
	async ({ request: _request }, seconds: string) => {
		await query("update sales set reservation_ttl_seconds = $1 where id = $2", [
			Number(seconds),
			world.saleId,
		]);
	},
);

Given(/^"([^"]+)" has reserved an item$/, async ({ request }, user: string) => {
	await reserve(request, user);
});

Given("the reservation state of the sale is lost from Redis", async () => {
	const redis = createClient({ url: E2E_REDIS_URL });
	await redis.connect();
	try {
		const names = ["ready", "buyers", "holds", "ids", "rebuild-lock"];
		await redis.del(names.map((name) => `sale:${world.saleId}:${name}`));
	} finally {
		await redis.close();
	}
});

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
		await sleep(Number(seconds) * 1000 + 200);
	},
);

When(
	/^all (\d+) shoppers reserve an item at the same time$/,
	async ({ request }, count: string) => {
		const users = Array.from(
			{ length: Number(count) },
			(_, i) => `shopper${i}`,
		);
		const replies = await Promise.all(users.map((user) => post(request, user)));
		shoppers().replies = await Promise.all(
			replies.map(async (reply) => ({
				status: reply.status(),
				error: reply.status() === 409 ? (await reply.json()).error : undefined,
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
		expect(Math.abs(ends - Date.now() - Number(seconds) * 1000)).toBeLessThan(
			5000,
		);
	},
);

Then(
	/^the reservation is the one "([^"]+)" had before$/,
	async ({ request: _request }, user: string) => {
		expect((await currentResponse().json()).reservationId).toBe(
			(shoppers().holds.get(user) as { reservationId: string }).reservationId,
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
