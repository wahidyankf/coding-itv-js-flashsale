// Steps for shoppers: those who queue, hold or buy before the page opens (they talk to flash-be directly, as other clients
// would), the shopper who is logged in through the page, and the buttons and labels the page shows. Binds
// sale/buying.feature, sale/checking.feature, sale/status.feature and account/login.feature.

import type { APIRequestContext } from "@playwright/test";
import { expect } from "@playwright/test";
import { createBdd } from "playwright-bdd";
import { TICKET_HEADER } from "../../flash-be-e2e/steps/support/api.js";
import { E2E_PASSWORD } from "../../flash-be-e2e/steps/support/auth.js";
import { currentSaleId } from "../../flash-be-e2e/steps/support/world.js";
import { getJson, postJson, salePath } from "./support/api.js";
import {
	connectWebServer,
	createAccount,
	loginOrSignUp,
	privateApi,
} from "./support/shop.js";

const { Given, When, Then } = createBdd();

// Shoppers that the scenario set up before the page opened talk to flash-be directly, as other clients would. Each holds
// the cookie of their own login.
async function joinAndWait(
	request: APIRequestContext,
	user: string,
): Promise<{ api: string; ticket: string; cookie: string }> {
	const api = await privateApi();
	const cookie = await loginOrSignUp(user);
	const sale = `${api}${salePath(currentSaleId())}`;
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

// Makes the shopper hold an item: queue, wait to be admitted, then reserve.
async function hold(
	request: APIRequestContext,
	user: string,
): Promise<{ api: string; reservationId: string; cookie: string }> {
	const { api, ticket, cookie } = await joinAndWait(request, user);
	const reserved = await postJson(
		request,
		`${api}${salePath(currentSaleId())}/reservations`,
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
		`${api}${salePath(currentSaleId())}/purchases`,
		{ reservationId },
		{ cookie },
	);
	expect(bought.status()).toBe(201);
});

Given(
	/^"([^"]+)" has done nothing$/,
	async ({ request: _request }, _user: string) => {
		// Nothing to set up: a shopper with no history is the default.
	},
);

// The line the scenario describes: shoppers who joined and are still waiting.
Given(
	/^(\d+) shoppers are ahead in the queue$/,
	async ({ request }, count: string) => {
		const api = await privateApi();
		for (let index = 0; index < Number(count); index++) {
			const joined = await postJson(
				request,
				`${api}${salePath(currentSaleId())}/queue`,
				{},
				{ cookie: await loginOrSignUp(`shopper${index}`) },
			);
			expect(joined.status()).toBe(201);
		}
	},
);

// The pages of a shopper who is logged in are reached through the web server, so the cookies are the browser's own.
Given(/^"([^"]+)" is logged in$/, async ({ page }, user: string) => {
	await loginOrSignUp(user);
	await connectWebServer();
	const reply = await page.request.post("/api/auth/login", {
		data: { username: user, password: E2E_PASSWORD },
	});
	expect(reply.status(), await reply.text()).toBe(200);
});

Given(
	/^"([^"]+)" has an account with the password "([^"]*)"$/,
	async ({ request: _request }, user: string, password: string) => {
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
