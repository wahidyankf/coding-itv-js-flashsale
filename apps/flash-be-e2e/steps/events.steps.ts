import { expect } from "@playwright/test";
import { createBdd } from "playwright-bdd";
import { shoppers } from "./queue.steps.js";
import { setResponse } from "./support/response.js";
import { openStream, type Stream } from "./support/stream.js";
import { query, startApi, world } from "./support/world.js";

const { Given, When, Then } = createBdd();

// The stream of the scenario. Closed in `cleanup` through `world.streams`.
let stream: Stream | undefined;

function current(): Stream {
	if (!stream) throw new Error("nobody is watching");
	return stream;
}

async function watch(path: string, headers: Record<string, string> = {}) {
	const url = await startApi();
	stream = await openStream(`${url}${path}`, headers);
	world.streams = [...(world.streams ?? []), stream.close];
}

function ticketOf(user: string): Record<string, string> {
	const ticket = shoppers().tickets.get(user.trim().toLowerCase());
	return ticket === undefined ? {} : { "x-queue-ticket": ticket };
}

Given("a client is watching the sale", async ({ request: _request }) => {
	await watch(`/sales/${world.saleId}/events`);
	await current().next();
});

When("a client watches the sale", async ({ request: _request }) => {
	await watch(`/sales/${world.saleId}/events`);
});

// A refusal is a plain JSON reply, so the shared status and error steps read it.
When(
	/^a client watches the sale with id "([^"]+)"$/,
	async ({ request }, id: string) => {
		const url = await startApi();
		setResponse(await request.get(`${url}/sales/${id}/events`));
	},
);

Given(
	/^"([^"]+)" is watching her place$/,
	async ({ request: _request }, user: string) => {
		await watch(
			`/sales/${world.saleId}/queue/${encodeURIComponent(user)}/events`,
			ticketOf(user),
		);
		await current().next();
	},
);

When(
	/^"([^"]+)" watches her place$/,
	async ({ request: _request }, user: string) => {
		await watch(
			`/sales/${world.saleId}/queue/${encodeURIComponent(user)}/events`,
			ticketOf(user),
		);
	},
);

When(
	/^"([^"]+)" watches her place with a wrong ticket$/,
	async ({ request }, user: string) => {
		const url = await startApi();
		setResponse(
			await request.get(
				`${url}/sales/${world.saleId}/queue/${encodeURIComponent(user)}/events`,
				{ headers: { "x-queue-ticket": "not-the-ticket" } },
			),
		);
	},
);

// The private API admits on its own timer, so the shopper is admitted within a tick.
When("the sale opens", async ({ request: _request }) => {
	await query(
		"update sales set starts_at = now() - interval '1 hour' where id = $1",
		[world.saleId],
	);
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
		expect(next.data.status).toBe(status);
		expect(next.data.remaining).toBe(Number(left));
	},
);

Then(
	/^the next event is "([^"]+)" with the state "([^"]+)"$/,
	async ({ request: _request }, event: string, state: string) => {
		const next = await current().next();
		expect(next.event).toBe(event);
		expect(next.data.state).toBe(state);
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
		expect(first.data.state).toBe(state);
		expect(first.data.place).toBe(Number(place));
	},
);
