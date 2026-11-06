import { ADMIN_AUTH_HEADER, routes } from "@flash/contract";
import { type APIResponse, expect } from "@playwright/test";
import { createBdd } from "playwright-bdd";
import { bodyOf, send } from "./support/api.js";
import { currentResponse, setResponse } from "./support/response.js";
import { migratedDatabase, query, world } from "./support/world.js";

const { Given, When, Then } = createBdd();

const MINUTE_MS = 60_000;

// The responses of operators who created at the same moment.
let racers: APIResponse[] = [];

async function ensureDatabase(): Promise<void> {
	if (!world.databaseUrl) await migratedDatabase();
}

// The token is read when the private API starts, so it is set before any request.
async function useToken(token: string): Promise<void> {
	await ensureDatabase();
	world.apiEnv = { ...world.apiEnv, ADMIN_TOKEN: token };
}

function create(
	request: Parameters<typeof send>[0],
	stock: number,
	startsIn: number,
	minutes: number,
	authorization: string | undefined,
): Promise<APIResponse> {
	const startsAt = new Date(Date.now() + startsIn * MINUTE_MS);
	return send(request, routes.createSale, {
		headers:
			authorization === undefined ? {} : { [ADMIN_AUTH_HEADER]: authorization },
		body: {
			stock,
			startsAt: startsAt.toISOString(),
			endsAt: new Date(startsAt.getTime() + minutes * MINUTE_MS).toISOString(),
		},
	});
}

Given(
	/^the admin token is "([^"]+)"$/,
	async ({ request: _request }, token: string) => {
		await useToken(token);
	},
);

Given("no admin token is set", async ({ request: _request }) => {
	await useToken("");
});

Given(
	/^a sale was created with stock (\d+), opening in (\d+) minutes for (\d+) minutes$/,
	async ({ request }, stock: string, startsIn: string, minutes: string) => {
		const made = await create(
			request,
			Number(stock),
			Number(startsIn),
			Number(minutes),
			`Bearer ${world.apiEnv?.ADMIN_TOKEN ?? ""}`,
		);
		expect(made.status()).toBe(201);
	},
);

When(
	/^the operator creates a sale with stock (\d+), opening in (\d+) minutes for (\d+) minutes, using the token "([^"]+)"$/,
	async (
		{ request },
		stock: string,
		startsIn: string,
		minutes: string,
		token: string,
	) => {
		setResponse(
			await create(
				request,
				Number(stock),
				Number(startsIn),
				Number(minutes),
				`Bearer ${token}`,
			),
		);
	},
);

When(
	/^the operator creates a sale with stock (\d+), opening in (\d+) minutes for (\d+) minutes, without a token$/,
	async ({ request }, stock: string, startsIn: string, minutes: string) => {
		setResponse(
			await create(
				request,
				Number(stock),
				Number(startsIn),
				Number(minutes),
				undefined,
			),
		);
	},
);

When(
	/^(\d+) operators create a sale with stock (\d+), opening in (\d+) minutes for (\d+) minutes, at the same moment$/,
	async (
		{ request },
		operators: string,
		stock: string,
		startsIn: string,
		minutes: string,
	) => {
		racers = await Promise.all(
			Array.from({ length: Number(operators) }, () =>
				create(
					request,
					Number(stock),
					Number(startsIn),
					Number(minutes),
					`Bearer ${world.apiEnv?.ADMIN_TOKEN ?? ""}`,
				),
			),
		);
	},
);

Then(
	/^the new sale is "([^"]+)" with (\d+) items remaining$/,
	async ({ request: _request }, status: string, remaining: string) => {
		const made = await currentResponse().json();
		expect(made.status).toBe(status);
		expect(made.remaining).toBe(Number(remaining));
	},
);

Then("the current sale is the new sale", async ({ request }) => {
	const made = await currentResponse().json();
	const current = await bodyOf(
		routes.currentSale,
		await send(request, routes.currentSale, {}),
	);
	expect(current?.id).toBe(made.id);
});

Then(
	/^the number of sales is (\d+)$/,
	async ({ request: _request }, count: string) => {
		expect(await query("select 1 from sales")).toHaveLength(Number(count));
	},
);

Then(
	/^exactly (\d+) of them gets status (\d+)$/,
	async ({ request: _request }, count: string, status: string) => {
		expect(
			racers.filter((racer) => racer.status() === Number(status)),
		).toHaveLength(Number(count));
	},
);

Then(
	/^the others get status (\d+) with the error "([^"]+)"$/,
	async ({ request: _request }, status: string, error: string) => {
		const others = racers.filter((racer) => racer.status() !== 201);
		expect(others.length).toBeGreaterThan(0);
		for (const other of others) {
			expect(other.status()).toBe(Number(status));
			expect((await other.json()).error).toBe(error);
		}
	},
);
