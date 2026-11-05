import { type APIRequestContext, expect } from "@playwright/test";
import { createBdd } from "playwright-bdd";
import { shoppers } from "./queue.steps.js";
import { currentResponse, setResponse } from "./support/response.js";
import { query, startApi, world } from "./support/world.js";

const { Given, When, Then } = createBdd();

type Request = APIRequestContext;

const key = (user: string) => user.trim().toLowerCase();

function holdOf(user: string): { reservationId: string } | undefined {
	return shoppers().holds.get(key(user)) as
		| { reservationId: string }
		| undefined;
}

async function post(
	request: Request,
	user: string,
	options: { reservationId?: string; owner?: string; saleId?: string } = {},
) {
	const url = await startApi();
	const reservationId =
		options.reservationId ?? holdOf(options.owner ?? user)?.reservationId;
	return request.post(
		`${url}/sales/${options.saleId ?? world.saleId}/purchases`,
		{
			data: { userId: user, reservationId },
		},
	);
}

async function confirm(
	request: Request,
	user: string,
	options: { reservationId?: string; owner?: string } = {},
) {
	const reply = await post(request, user, options);
	setResponse(reply);
	if (
		(reply.status() === 201 || reply.status() === 200) &&
		!purchases().has(key(user))
	) {
		purchases().set(key(user), await reply.json());
	}
}

function purchases(): Map<string, unknown> {
	return shoppers().purchases;
}

async function outcome(request: Request, user: string, saleId = world.saleId) {
	const url = await startApi();
	setResponse(
		await request.get(
			`${url}/sales/${saleId}/purchases/${encodeURIComponent(user)}`,
		),
	);
	return currentResponse().json();
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
		const url = await startApi();
		const users = Array.from(
			{ length: Number(count) },
			(_, i) => `shopper${i}`,
		);
		const replies = await Promise.all(
			users.map(async (user) => ({
				user,
				reply: await request.post(`${url}/sales/${world.saleId}/reservations`, {
					data: { userId: user },
					headers: { "x-queue-ticket": shoppers().tickets.get(user) ?? "" },
				}),
			})),
		);
		for (const { user, reply } of replies) {
			if (reply.status() === 201)
				shoppers().holds.set(user, await reply.json());
		}
	},
);

When(/^"([^"]+)" confirms the purchase$/, async ({ request }, user: string) => {
	await confirm(request, user);
});

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

When(
	/^"([^"]+)" buys the last item$/,
	async ({ request: _request }, user: string) => {
		await query(
			`insert into purchases (sale_id, user_id, reservation_id, payment_ref)
			 values ($1, $2, gen_random_uuid(), $3)`,
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
			(purchases().get(key(user)) as { purchaseId: string }).purchaseId,
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
	expect((await outcome(request, user)).state).toBe("holding");
});

Then(/^"([^"]+)" has no purchase$/, async ({ request }, user: string) => {
	expect((await outcome(request, user)).state).toBe("none");
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
