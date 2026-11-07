import { expect } from "@playwright/test";
import { createBdd } from "playwright-bdd";
import { shoppers } from "./queue.steps.js";
import { build, routes, send, TICKET_HEADER } from "./support/api.js";
import { changeSale } from "./support/operator.js";
import { setResponse } from "./support/response.js";
import { openStream, type Stream } from "./support/stream.js";
import { world } from "./support/world.js";

const { Given, When, Then } = createBdd();

// The stream of the scenario. Closed in `cleanup` through `world.streams`.
let stream: Stream | undefined;

function current(): Stream {
	if (!stream) throw new Error("nobody is watching");
	return stream;
}

async function watchSale(saleId: string) {
	const built = await build(routes.saleEvents, { params: { saleId } });
	await watch(built.url, built.headers);
}

async function watchPlace(user: string) {
	const built = await build(routes.placeEvents, {
		params: { saleId: world.saleId ?? "", userId: user },
		headers: {
			[TICKET_HEADER]: shoppers().tickets.get(user.trim().toLowerCase()),
		},
	});
	await watch(built.url, built.headers);
}

async function watch(url: string, headers: Record<string, string>) {
	stream = await openStream(url, headers);
	world.streams = [...(world.streams ?? []), stream.close];
}

Given("a client is watching the sale", async ({ request: _request }) => {
	await watchSale(world.saleId ?? "");
	await current().next();
});

When("a client watches the sale", async ({ request: _request }) => {
	await watchSale(world.saleId ?? "");
});

// A refusal is a plain JSON reply, so the shared status and error steps read it.
When(
	/^a client watches the sale with id "([^"]+)"$/,
	async ({ request }, id: string) => {
		setResponse(
			await send(request, routes.saleEvents, { params: { saleId: id } }),
		);
	},
);

Given(
	/^"([^"]+)" is watching her place$/,
	async ({ request: _request }, user: string) => {
		await watchPlace(user);
		await current().next();
	},
);

When(
	/^"([^"]+)" watches her place$/,
	async ({ request: _request }, user: string) => {
		await watchPlace(user);
	},
);

When(
	/^"([^"]+)" watches her place with a wrong ticket$/,
	async ({ request }, user: string) => {
		setResponse(
			await send(request, routes.placeEvents, {
				params: { saleId: world.saleId ?? "", userId: user },
				headers: { [TICKET_HEADER]: "not-the-ticket" },
			}),
		);
	},
);

const HOUR_MS = 3_600_000;

// The operator moves the start of a sale that has not opened. The private API admits on its own timer, so the shopper is
// admitted within a tick.
When("the sale opens", async ({ request }) => {
	await changeSale(request, world.saleId ?? "", {
		startsAt: new Date(Date.now() - HOUR_MS).toISOString(),
	});
});

Then(
	/^the (?:first|next) event is "([^"]+)" with status "([^"]+)" and (\d+) items remaining$/,
	async (
		{ request: _request },
		event: string,
		status: string,
		left: string,
	) => {
		const next = await current().next();
		expect(next.event).toBe(event);
		const sale = next.event === "sale" ? next.data : undefined;
		expect(sale?.status).toBe(status);
		expect(sale?.remaining).toBe(Number(left));
	},
);

Then(
	/^the next event is "([^"]+)" with the state "([^"]+)"$/,
	async ({ request: _request }, event: string, state: string) => {
		const next = await current().next();
		expect(next.event).toBe(event);
		expect(next.event === "place" ? next.data.state : undefined).toBe(state);
	},
);

Then(
	/^the first event is "([^"]+)" with the state "([^"]+)" at place (\d+)$/,
	async (
		{ request: _request },
		event: string,
		state: string,
		place: string,
	) => {
		const first = await current().next();
		expect(first.event).toBe(event);
		const view = first.event === "place" ? first.data : undefined;
		expect(view?.state).toBe(state);
		expect(view?.state === "waiting" ? view.place : undefined).toBe(
			Number(place),
		);
	},
);
