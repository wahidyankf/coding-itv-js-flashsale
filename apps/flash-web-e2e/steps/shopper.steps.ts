import type { APIRequestContext } from "@playwright/test";
import { expect } from "@playwright/test";
import { createBdd } from "playwright-bdd";
import { getJson, postJson, salePath, TICKET_HEADER } from "./support/api.js";
import {
	connectWebServer,
	cookieFor,
	createAccount,
	E2E_PASSWORD,
	privateApi,
	world,
} from "./support/shop.js";

const { Given, When, Then } = createBdd();

// Shoppers that the scenario set up before the page opened talk to flash-be directly, as other clients would. Each
// holds the cookie of their own login.
async function joinAndWait(
	request: APIRequestContext,
	user: string,
): Promise<{ api: string; ticket: string; cookie: string }> {
	const api = await privateApi();
	const cookie = await cookieFor(user);
	const sale = `${api}${salePath(world.saleId)}`;
	const joined = await postJson(request, `${sale}/queue`, {}, { cookie });
	const ticket: string = (await joined.json()).ticket ?? "";
	await expect
		.poll(
			async () => {
				const place = await getJson(request, `${sale}/queue/me`, {
					cookie,
					[TICKET_HEADER]: ticket,
				});
				return (await place.json()).state;
			},
			{ timeout: 20_000 },
		)
		.toBe("admitted");
	return { api, ticket, cookie };
}

async function hold(
	request: APIRequestContext,
	user: string,
): Promise<{ api: string; reservationId: string; cookie: string }> {
	const { api, ticket, cookie } = await joinAndWait(request, user);
	const reserved = await postJson(
		request,
		`${api}${salePath(world.saleId)}/reservations`,
		{},
		{ cookie, [TICKET_HEADER]: ticket },
	);
	expect(reserved.status()).toBe(201);
	return {
		api,
		cookie,
		reservationId: (await reserved.json()).reservationId ?? "",
	};
}

Given(/^"([^"]+)" holds the last item$/, async ({ request }, user: string) => {
	await hold(request, user);
});

Given(/^"([^"]+)" holds an item$/, async ({ request }, user: string) => {
	await hold(request, user);
});

Given(/^"([^"]+)" has bought an item$/, async ({ request }, user: string) => {
	const { api, reservationId, cookie } = await hold(request, user);
	const bought = await postJson(
		request,
		`${api}${salePath(world.saleId)}/purchases`,
		{ reservationId },
		{ cookie },
	);
	expect(bought.status()).toBe(201);
});

// biome-ignore lint/correctness/noEmptyPattern: playwright-bdd needs an object pattern as the first argument
Given(/^"([^"]+)" has done nothing$/, async ({}, _user: string) => {
	// Nothing to set up: a shopper with no history is the default.
});

// The line the scenario describes: shoppers who joined and are still waiting.
Given(
	/^(\d+) shoppers are ahead in the queue$/,
	async ({ request }, count: string) => {
		const api = await privateApi();
		for (let index = 0; index < Number(count); index++) {
			const joined = await postJson(
				request,
				`${api}${salePath(world.saleId)}/queue`,
				{},
				{ cookie: await cookieFor(`shopper${index}`) },
			);
			expect(joined.status()).toBe(201);
		}
	},
);

// The pages of a shopper who is logged in are reached through the web server, so the cookies are the browser's own.
Given(/^"([^"]+)" is logged in$/, async ({ page }, user: string) => {
	await cookieFor(user);
	await connectWebServer();
	const reply = await page.request.post("/api/auth/login", {
		data: { username: user, password: E2E_PASSWORD },
	});
	expect(reply.status(), await reply.text()).toBe(200);
});

Given(
	/^"([^"]+)" has an account with the password "([^"]*)"$/,
	// biome-ignore lint/correctness/noEmptyPattern: playwright-bdd needs an object pattern as the first argument
	async ({}, user: string, password: string) => {
		await createAccount(user, password);
	},
);

When("she presses Buy Now", async ({ page }) => {
	await page.getByRole("button", { name: "Buy Now" }).click();
});

When("she presses Check my status", async ({ page }) => {
	await page.getByRole("button", { name: "Check my status" }).click();
});

When("she confirms the purchase", async ({ page }) => {
	await page.getByRole("button", { name: "Confirm purchase" }).click();
});

Then(
	/^the page shows the status "([^"]+)"$/,
	async ({ page }, label: string) => {
		await expect(page.getByText(`Status: ${label}`)).toBeVisible();
	},
);

Then(/^the page shows (\d+) items left$/, async ({ page }, left: string) => {
	await expect(page.getByText(`Items left: ${left}`)).toBeVisible();
});

Then(
	/^the "([^"]+)" button is (enabled|disabled)$/,
	async ({ page }, name: string, state: string) => {
		const button = page.getByRole("button", { name });
		if (state === "enabled") await expect(button).toBeEnabled();
		else await expect(button).toBeDisabled();
	},
);
