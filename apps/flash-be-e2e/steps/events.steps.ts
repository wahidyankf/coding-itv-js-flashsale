// Steps for the event streams: a client watches the sale or a shopper's place, and the events that come next (a sale's
// status and items left, a place in line). Binds events/streaming.feature, and the stream that ends in health/shutdown.feature.
// A stream a scenario opens is closed in cleanup.

import { MS_PER_HOUR } from "@flash/flash-commons";
import type { APIRequestContext } from "@playwright/test";
import { expect } from "@playwright/test";
import { createBdd } from "playwright-bdd";
import { build, routes, send, TICKET_HEADER } from "./support/api.js";
import { shopperCookie } from "./support/auth.js";
import { patchSale } from "./support/operator.js";
import { setResponse } from "./support/response.js";
import { ticketOf } from "./support/shoppers.js";
import { openStream, type Stream } from "./support/stream.js";
import { currentSaleId, world } from "./support/world.js";

const { Given, When, Then } = createBdd();

// The stream of the scenario. Closed in `cleanup` through `world.streams`.
let stream: Stream | undefined;

function currentStream(): Stream {
	if (!stream) throw new Error("nobody is watching");
	return stream;
}

async function watchSale(saleId: string) {
	const built = await build(routes.saleEvents, { params: { saleId } });
	await watch(built.url, built.headers);
}

async function watchPlace(request: APIRequestContext, user: string) {
	const built = await build(routes.placeEvents, {
		params: { saleId: currentSaleId() },
		headers: {
			cookie: await shopperCookie(request, user),
			[TICKET_HEADER]: ticketOf(user),
		},
	});
	await watch(built.url, built.headers);
}

async function watch(url: string, headers: Record<string, string>) {
	stream = await openStream(url, headers);
	world.streams = [...(world.streams ?? []), stream.close];
}

Given("a client is watching the sale", async ({ request: _request }) => {
	await watchSale(currentSaleId());
	await currentStream().next();
});

When("a client watches the sale", async ({ request: _request }) => {
	await watchSale(currentSaleId());
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
	async ({ request }, user: string) => {
		await watchPlace(request, user);
		await currentStream().next();
	},
);

When(/^"([^"]+)" watches her place$/, async ({ request }, user: string) => {
	await watchPlace(request, user);
});

When(
	/^"([^"]+)" watches her place with a wrong ticket$/,
	async ({ request }, user: string) => {
		setResponse(
			await send(request, routes.placeEvents, {
				params: { saleId: currentSaleId() },
				headers: {
					cookie: await shopperCookie(request, user),
					[TICKET_HEADER]: "not-the-ticket",
				},
			}),
		);
	},
);

// A watch in a sale that is not there. The API refuses it before it opens a stream, so the reply is a plain JSON one.
When(
	/^"([^"]+)" watches her place in the sale with id "([^"]+)"$/,
	async ({ request }, user: string, saleId: string) => {
		setResponse(
			await send(request, routes.placeEvents, {
				params: { saleId },
				headers: {
					cookie: await shopperCookie(request, user),
					[TICKET_HEADER]: ticketOf(user),
				},
			}),
		);
	},
);

// The operator moves the start of a sale that has not opened. The private API admits on its own timer, so the shopper is
// admitted within one admission tick.
When("the sale opens", async ({ request }) => {
	await patchSale(request, currentSaleId(), {
		startsAt: new Date(Date.now() - MS_PER_HOUR).toISOString(),
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
		const next = await currentStream().next();
		expect(next.event).toBe(event);
		const sale = next.event === "sale" ? next.data : undefined;
		expect(sale?.status).toBe(status);
		expect(sale?.remaining).toBe(Number(left));
	},
);

Then(
	/^the (?:first|next) event is "([^"]+)" with the state "([^"]+)"$/,
	async ({ request: _request }, event: string, state: string) => {
		const next = await currentStream().next();
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
		const first = await currentStream().next();
		expect(first.event).toBe(event);
		const view = first.event === "place" ? first.data : undefined;
		expect(view?.state).toBe(state);
		expect(view?.state === "waiting" ? view.place : undefined).toBe(
			Number(place),
		);
	},
);

// The API ends the stream when it stops, so the client reconnects elsewhere. No event comes before the end.
Then("the event stream ends", async ({ request: _request }) => {
	await expect(currentStream().next()).rejects.toThrow("the stream ended");
});
