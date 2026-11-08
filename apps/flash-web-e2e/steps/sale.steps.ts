// Steps for the sale as the page sees it: how the sale is planned (stock, sold items, window), the settings a scenario changes
// (the queue, the hold, the rate limit, the payment, the start and the end, the loss of the line), and the time that passes. Binds the sale scenarios of
// flash-web: sale/status.feature, sale/buying.feature and sale/checking.feature. The shoppers are in shopper.steps.ts.

import { HTTP_STATUS, MS_PER_SECOND } from "@flash/flash-commons";
import { createBdd } from "playwright-bdd";
import {
	ensureDatabase,
	query,
	setSold,
} from "../../flash-be-e2e/steps/support/database.js";
import {
	E2E_REDIS_URL,
	withRedis,
} from "../../flash-be-e2e/steps/support/processes.js";
import {
	currentSaleId,
	setApiEnv,
} from "../../flash-be-e2e/steps/support/world.js";
import {
	answerWith,
	cutWebServerOff,
	dropApiConnections,
	planSale,
	reviseSale,
} from "./support/shop.js";

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

// The web server answers every call with a fault, as flash-be does when it fails: a 503 is "unavailable", any other is "internal".
Given(
	/^the server answers (\d+) from now on$/,
	async ({ request: _request }, status: string) => {
		const fault =
			Number(status) === HTTP_STATUS.serviceUnavailable
				? {
						errorCode: "unavailable",
						errorMessage:
							"The service cannot take this request now. Try again later.",
					}
				: {
						errorCode: "internal",
						errorMessage: "Something went wrong on the server.",
					};
		await answerWith(Number(status), JSON.stringify(fault));
	},
);

// The browser's calls to the sale fail before they reach the web server, as when the connection drops. The event streams
// are left alone, so the page keeps the streams it already has.
Given("the connection to the web server fails", async ({ page }) => {
	await page.route(
		(url) =>
			url.pathname.startsWith("/api/v1/sales/") &&
			!url.pathname.endsWith("/events"),
		(route) => route.abort(),
	);
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

// The sale's start comes while the page is open. An operator cannot move a start into the past, so the step writes the
// table, as time passing would.
When("the sale opens", async ({ request: _request }) => {
	await query(
		"update sales set starts_at = now() - interval '1 second' where id = $1",
		[currentSaleId()],
	);
});

// Redis loses the line, as a restart without its data does.
When("the queue is lost", async ({ request: _request }) => {
	await withRedis(E2E_REDIS_URL, (redis) => redis.flushDb());
});

// The network blips: the web server's connections to the API end, so each open stream ends, and the page opens it again.
When("the live connection drops", async ({ request: _request }) => {
	await dropApiConnections();
});

When(/^(\d+) seconds pass$/, async ({ page }, seconds: string) => {
	await page.waitForTimeout(Number(seconds) * MS_PER_SECOND);
});
