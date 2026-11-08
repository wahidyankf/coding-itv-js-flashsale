// Steps for the sale as the page sees it: how the sale is planned (stock, sold items, window), the settings a scenario changes
// (the queue, the hold, the rate limit, the payment, the end), and the time that passes. Binds the sale scenarios of
// flash-web: sale/status.feature, sale/buying.feature and sale/checking.feature. The shoppers are in shopper.steps.ts.

import { MS_PER_SECOND } from "@flash/flash-commons";
import { createBdd } from "playwright-bdd";
import {
	ensureDatabase,
	setSold,
} from "../../flash-be-e2e/steps/support/database.js";
import {
	currentSaleId,
	setApiEnv,
} from "../../flash-be-e2e/steps/support/world.js";
import { cutWebServerOff, planSale, reviseSale } from "./support/shop.js";

const { Given, When } = createBdd();

Given(
	/^a sale with stock (\d+) and (\d+) sold that opens (.+) and closes (.+)$/,
	async (
		{ request: _request },
		stock: string,
		sold: string,
		opens: string,
		closes: string,
	) => {
		planSale(Number(stock), Number(sold), opens, closes);
	},
);

// The scenario's database is brand new, so it holds no sale until a step adds one.
Given("no sale exists", async ({ request: _request }) => {
	await ensureDatabase();
});

Given("the sale cannot be reached", async ({ request: _request }) => {
	await cutWebServerOff();
});

// A slow line: the queue admits one shopper a second, and its timer runs every five seconds, so five shoppers go in at a time.
Given("the queue admits shoppers slowly", async ({ request: _request }) => {
	setApiEnv({ ADMISSION_TICK_MS: "5000" });
	await reviseSale({ admitPerSecond: 1 });
});

Given(
	/^each user may send (\d+) write requests? in each (\d+) seconds$/,
	async ({ request: _request }, count: string, seconds: string) => {
		setApiEnv({
			RATE_LIMIT_PER_USER: count,
			RATE_LIMIT_WINDOW_SECONDS: seconds,
		});
	},
);

Given(
	"the payment provider declines every charge",
	async ({ request: _request }) => {
		setApiEnv({ PAYMENT_FAILURE_RATE: "1" });
	},
);

Given(
	/^a hold lasts (\d+) seconds$/,
	async ({ request: _request }, seconds: string) => {
		await reviseSale({ holdSeconds: Number(seconds) });
	},
);

// Another flash-be instance sells items. No route sets the sold count, so the step writes it to the table.
When(
	/^the sold count changes to (\d+)$/,
	async ({ request: _request }, sold: string) => {
		await setSold(currentSaleId(), Number(sold));
	},
);

When("the sale ends", async ({ request: _request }) => {
	await reviseSale({ closes: new Date(Date.now() - MS_PER_SECOND) });
});

When(/^(\d+) seconds pass$/, async ({ page }, seconds: string) => {
	await page.waitForTimeout(Number(seconds) * MS_PER_SECOND);
});
