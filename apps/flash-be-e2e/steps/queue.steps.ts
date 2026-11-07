import { type APIRequestContext, expect } from "@playwright/test";
import { createBdd } from "playwright-bdd";
import { createClient } from "redis";
import { bodyOf, routes, send, TICKET_HEADER } from "./support/api.js";
import { shopperCookie } from "./support/auth.js";
import { changeSale, createSale } from "./support/operator.js";
import { currentResponse, setResponse } from "./support/response.js";
import { relativeTime } from "./support/time.js";
import { E2E_REDIS_URL, world } from "./support/world.js";

const { Given, When, Then } = createBdd();

type Request = APIRequestContext;

export function shoppers(): NonNullable<typeof world.queue> {
	world.queue ??= {
		tickets: new Map(),
		joined: [],
		holds: new Map(),
		purchases: new Map(),
		replies: [],
	};
	return world.queue;
}

export async function join(
	request: Request,
	user: string,
	saleId = world.saleId,
) {
	const reply = await send(request, routes.joinQueue, {
		params: { saleId: saleId ?? "" },
		headers: { cookie: await shopperCookie(request, user) },
	});
	setResponse(reply);
	const joined = await bodyOf(routes.joinQueue, reply);
	const held = shoppers();
	const key = user.trim().toLowerCase();
	if (joined && !held.tickets.has(key)) {
		held.tickets.set(key, joined.ticket);
		held.joined.push(key);
	}
}

// Asks for a place. Returns it when the API gave one, and nothing when it refused.
export async function check(request: Request, user: string, ticket?: string) {
	const reply = await send(request, routes.checkPlace, {
		params: { saleId: world.saleId ?? "" },
		headers: {
			cookie: await shopperCookie(request, user),
			[TICKET_HEADER]: ticket,
		},
	});
	setResponse(reply);
	return bodyOf(routes.checkPlace, reply);
}

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
		await changeSale(request, world.saleId ?? "", {
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

Given("the queue is lost", async () => {
	const redis = createClient({ url: E2E_REDIS_URL });
	await redis.connect();
	try {
		await redis.flushDb();
	} finally {
		await redis.close();
	}
});

// The private API admits on its own timer. A sale that is open admits its first shopper within one tick, so wait
// for that. A sale that is not open admits nobody, so wait out a tick and a half instead.
When("admission runs once", async ({ request }) => {
	const sale = await bodyOf(
		routes.sale,
		await send(request, routes.sale, {
			params: { saleId: world.saleId ?? "" },
		}),
	);
	const first = shoppers().joined[0];
	if (sale?.status !== "active" || !first) {
		await new Promise((resolve) => setTimeout(resolve, 1500));
		return;
	}
	const deadline = Date.now() + 5000;
	while (Date.now() < deadline) {
		const body = await check(request, first, shoppers().tickets.get(first));
		if (body?.state === "admitted") return;
		await new Promise((resolve) => setTimeout(resolve, 25));
	}
	throw new Error("the queue admitted nobody in time");
});

When(
	/^"([^"]+)" checks the queue with their ticket$/,
	async ({ request }, user: string) => {
		await check(request, user, shoppers().tickets.get(user));
	},
);

When(
	/^"([^"]+)" checks the queue with a wrong ticket$/,
	async ({ request }, user: string) => {
		await check(request, user, "not-the-ticket");
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
		const body = await check(request, user, shoppers().tickets.get(user));
		expect(body?.state === "waiting" ? body.place : undefined).toBe(
			Number(place),
		);
	},
);

Then(
	/^the ticket is the one "([^"]+)" had before$/,
	async ({ request: _request }, user: string) => {
		expect((await currentResponse().json()).ticket).toBe(
			shoppers().tickets.get(user),
		);
	},
);

Then(/^"([^"]+)" is admitted$/, async ({ request }, user: string) => {
	const body = await check(request, user, shoppers().tickets.get(user));
	expect(body?.state).toBe("admitted");
});

Then(
	/^"([^"]+)" is waiting at place (\d+)$/,
	async ({ request }, user: string, place: string) => {
		const body = await check(request, user, shoppers().tickets.get(user));
		expect(body).toMatchObject({ state: "waiting", place: Number(place) });
	},
);
