import { createBdd } from "playwright-bdd";
import {
	changeSale,
	cutWebServerOff,
	ensureDatabase,
	planSale,
	query,
	setApiEnv,
	world,
} from "./support/shop.js";

const { Given, When } = createBdd();

Given(
	/^a sale with stock (\d+) and (\d+) sold that opens (.+) and closes (.+)$/,
	// biome-ignore lint/correctness/noEmptyPattern: playwright-bdd needs an object pattern as the first argument
	async ({}, stock: string, sold: string, opens: string, closes: string) => {
		planSale(Number(stock), Number(sold), opens, closes);
	},
);

// The scenario's database is brand new, so it holds no sale until a step adds one.
// biome-ignore lint/correctness/noEmptyPattern: playwright-bdd needs an object pattern as the first argument
Given("no sale exists", async ({}) => {
	await ensureDatabase();
});

// biome-ignore lint/correctness/noEmptyPattern: playwright-bdd needs an object pattern as the first argument
Given("the sale cannot be reached", async ({}) => {
	await cutWebServerOff();
});

// A slow line: one user a second, and a pause of five seconds between admissions, so five users go in at a time.
// biome-ignore lint/correctness/noEmptyPattern: playwright-bdd needs an object pattern as the first argument
Given("the queue admits shoppers slowly", async ({}) => {
	setApiEnv({ ADMISSION_TICK_MS: "5000" });
	await changeSale({ admitPerSecond: 1 });
});

Given(
	/^each user may send (\d+) write requests? in each (\d+) seconds$/,
	// biome-ignore lint/correctness/noEmptyPattern: playwright-bdd needs an object pattern as the first argument
	async ({}, count: string, seconds: string) => {
		setApiEnv({
			RATE_LIMIT_PER_USER: count,
			RATE_LIMIT_WINDOW_SECONDS: seconds,
		});
	},
);

// biome-ignore lint/correctness/noEmptyPattern: playwright-bdd needs an object pattern as the first argument
Given("the payment provider declines every charge", async ({}) => {
	setApiEnv({ PAYMENT_FAILURE_RATE: "1" });
});

Given(
	/^a hold lasts (\d+) seconds$/,
	// biome-ignore lint/correctness/noEmptyPattern: playwright-bdd needs an object pattern as the first argument
	async ({}, seconds: string) => {
		await changeSale({ holdSeconds: Number(seconds) });
	},
);

// Another flash-be instance sells behind this one's back. No route sets the sold count, so it is written to the table.
When(
	/^the sold count changes to (\d+)$/,
	// biome-ignore lint/correctness/noEmptyPattern: playwright-bdd needs an object pattern as the first argument
	async ({}, sold: string) => {
		await query("update sales set sold = $1 where id = $2", [
			Number(sold),
			world.saleId,
		]);
	},
);

// biome-ignore lint/correctness/noEmptyPattern: playwright-bdd needs an object pattern as the first argument
When("the sale ends", async ({}) => {
	await changeSale({ closes: new Date(Date.now() - 1000) });
});

When(/^(\d+) seconds pass$/, async ({ page }, seconds: string) => {
	await page.waitForTimeout(Number(seconds) * 1000);
});
