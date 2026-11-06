import { describeFeature, loadFeature } from "@amiceli/vitest-cucumber";
import type { FastifyInstance } from "fastify";
import { afterEach, expect } from "vitest";
import type { Sale } from "../domain/sale.js";
import { appWithSales, fakeSale } from "./support/fake-sales.js";
import { specFile } from "./support/paths.js";
import { relativeTime } from "./support/time.js";

type Response = Awaited<ReturnType<FastifyInstance["inject"]>>;

// A fixed moment for every scenario, so "in 1 hour" always means the same thing.
const NOW = new Date("2026-06-01T12:00:00Z");
const clock = () => NOW;

const apps: FastifyInstance[] = [];

afterEach(async () => {
	await Promise.all(apps.splice(0).map((app) => app.close()));
});

function appFor(sales: Sale[]): FastifyInstance {
	const app = appWithSales(sales, clock);
	apps.push(app);
	return app;
}

describeFeature(
	await loadFeature(specFile("flash/be/behaviours/sale/status.feature")),
	({ Scenario, ScenarioOutline }) => {
		ScenarioOutline(
			"The sale reports its status from its window and its stock",
			({ Given, When, Then, And }, examples) => {
				let sale: Sale;
				let response: Response;

				Given(
					"a sale with stock <stock> and <sold> sold that opens <opens> and closes <closes>",
					() => {
						sale = fakeSale({
							stock: Number(examples.stock),
							sold: Number(examples.sold),
							startsAt: relativeTime(String(examples.opens), NOW),
							endsAt: relativeTime(String(examples.closes), NOW),
						});
					},
				);

				When("a client asks for that sale", async () => {
					response = await appFor([sale]).inject({
						method: "GET",
						url: `/sales/${sale.id}`,
					});
				});

				Then("the response status is 200", () => {
					expect(response.statusCode).toBe(200);
				});

				And('the sale status is "<status>"', () => {
					expect(response.json().status).toBe(examples.status);
				});

				And("<remaining> items remain", () => {
					expect(response.json().remaining).toBe(Number(examples.remaining));
				});
			},
		);

		Scenario(
			"The current sale is the one that opens last",
			({ Given, And, When, Then }) => {
				const sales: Sale[] = [];
				let response: Response;

				Given(
					"a sale named {string} that opened {any}",
					(_ctx, name: string, opened: string) => {
						sales.push(fakeSale({ name, startsAt: relativeTime(opened, NOW) }));
					},
				);

				And(
					"a sale named {string} that opened {any}",
					(_ctx, name: string, opened: string) => {
						sales.push(fakeSale({ name, startsAt: relativeTime(opened, NOW) }));
					},
				);

				When("a client asks for the current sale", async () => {
					response = await appFor(sales).inject({
						method: "GET",
						url: "/sales/current",
					});
				});

				Then("the response status is 200", () => {
					expect(response.statusCode).toBe(200);
				});

				And("the sale name is {string}", (_ctx, name: string) => {
					expect(response.json().name).toBe(name);
				});
			},
		);

		Scenario(
			"There is no current sale before one is created",
			({ Given, When, Then, And }) => {
				let response: Response;

				Given("no sale exists", () => {});

				When("a client asks for the current sale", async () => {
					response = await appFor([]).inject({
						method: "GET",
						url: "/sales/current",
					});
				});

				Then("the response status is 404", () => {
					expect(response.statusCode).toBe(404);
				});

				And("the error is {string}", (_ctx, error: string) => {
					expect(response.json().errorCode).toBe(error);
				});
			},
		);

		ScenarioOutline(
			"An unknown sale is refused",
			({ Given, When, Then, And }, examples) => {
				let response: Response;

				Given("no sale exists", () => {});

				When('a client asks for the sale with id "<id>"', async () => {
					response = await appFor([]).inject({
						method: "GET",
						url: `/sales/${examples.id}`,
					});
				});

				Then("the response status is 404", () => {
					expect(response.statusCode).toBe(404);
				});

				And("the error is {string}", (_ctx, error: string) => {
					expect(response.json().errorCode).toBe(error);
				});
			},
		);
	},
);
