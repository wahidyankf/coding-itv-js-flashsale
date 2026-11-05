import { expect } from "@playwright/test";
import { createBdd } from "playwright-bdd";
import { query, seed, world } from "./support/world.js";

const { When, Then } = createBdd();

When(
	/^the sale is seeded with stock (\d+), opening in (\d+) minutes for (\d+) minutes$/,
	async (
		{ request: _request },
		stock: string,
		startsIn: string,
		duration: string,
	) => {
		seed([
			"--stock",
			String(stock),
			"--starts-in-minutes",
			String(startsIn),
			"--duration-minutes",
			String(duration),
		]);
	},
);

Then(
	/^the sales table holds (\d+) sale with stock (\d+)$/,
	async ({ request: _request }, count: string, stock: string) => {
		expect(world.seed?.status, world.seed?.stderr).toBe(0);
		const rows = await query<{ stock: number }>("select stock from sales");
		expect(rows).toHaveLength(Number(count));
		expect(rows[0]?.stock).toBe(Number(stock));
	},
);

Then(
	/^that sale is open for (\d+) minutes$/,
	async ({ request: _request }, minutes: string) => {
		const rows = await query<{ minutes: string }>(
			"select extract(epoch from (ends_at - starts_at)) / 60 as minutes from sales",
		);
		expect(Number(rows[0]?.minutes)).toBe(Number(minutes));
	},
);

Then(
	/^seeding fails with "([^"]+)"$/,
	async ({ request: _request }, message: string) => {
		expect(world.seed?.status).toBe(1);
		expect(world.seed?.stderr).toContain(message);
	},
);

Then(
	/^the sales table holds (\d+) sales$/,
	async ({ request: _request }, count: string) => {
		const rows = await query("select 1 from sales");
		expect(rows).toHaveLength(Number(count));
	},
);
