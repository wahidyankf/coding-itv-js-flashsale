import { describeFeature, loadFeature } from "@amiceli/vitest-cucumber";
import { expect } from "vitest";
import { openSale } from "./support/open-sale";
import { specFile } from "./support/paths";
import { unitWorld } from "./support/unit-world";
import type { ApiAnswer } from "./support/web-world";

const world = unitWorld();
let answer: ApiAnswer | undefined;

function reply(): ApiAnswer {
	if (!answer) throw new Error("no request was sent");
	return answer;
}

const SALE_3 =
	"a sale with stock 10 and 3 sold that opens 1 hour ago and closes in 1 hour";
const SALE_0 =
	"a sale with stock 10 and 0 sold that opens 1 hour ago and closes in 1 hour";

describeFeature(
	await loadFeature(specFile("flash/web/behaviours/proxy/api.feature")),
	({ Scenario, ScenarioOutline, BeforeEachScenario, AfterEachScenario }) => {
		BeforeEachScenario(() => {
			world.reset();
			answer = undefined;
		});
		AfterEachScenario(() => world.clear());

		Scenario(
			"The browser reads the sale through the web server",
			({ Given, When, Then, And }) => {
				Given(SALE_3, async () =>
					openSale(world, 10, 3, "1 hour ago", "in 1 hour"),
				);

				When("a client sends GET /api/sales/current", async () => {
					answer = await world.send("GET", "/api/sales/current");
				});

				Then("the response status is {int}", (_ctx, status: number) => {
					expect(reply().status).toBe(status);
				});

				And("the body names the sale", () => {
					expect(reply().json.id).toBe(world.saleId);
				});
			},
		);

		Scenario(
			"The page does not contain the address of the API",
			({ Given, When, Then }) => {
				Given(SALE_3, async () =>
					openSale(world, 10, 3, "1 hour ago", "in 1 hour"),
				);

				When("a visitor opens the page", async () => world.openPage());

				Then("the page does not contain the address of the API", () => {
					expect(world.renderedPage()).not.toContain(world.apiAddress());
				});
			},
		);

		ScenarioOutline(
			"Paths outside the sale are refused",
			({ When, Then, And }, examples) => {
				When("a client sends GET <path>", async () => {
					answer = await world.send("GET", String(examples.path));
				});

				Then("the response status is {int}", (_ctx, status: number) => {
					expect(reply().status).toBe(status);
				});

				And("the body has error {string}", (_ctx, error: string) => {
					expect(reply().json.errorCode).toBe(error);
				});
			},
		);

		Scenario(
			"A write request is passed on with the ticket",
			({ Given, When, Then, And }) => {
				Given(SALE_0, async () =>
					openSale(world, 10, 0, "1 hour ago", "in 1 hour"),
				);

				When("a client joins the queue through the web server", async () => {
					answer = await world.send(
						"POST",
						`/api/sales/${world.saleId}/queue`,
						{
							userId: "ana",
						},
					);
				});

				Then("the response status is {int}", (_ctx, status: number) => {
					expect(reply().status).toBe(status);
				});

				And("the body has a ticket", () => {
					expect(typeof reply().json.ticket).toBe("string");
				});
			},
		);

		Scenario(
			"An API that cannot be reached gives a gateway error",
			({ Given, When, Then, And }) => {
				Given("the sale cannot be reached", () => world.cutOff());

				When("a client sends GET /api/sales/current", async () => {
					answer = await world.send("GET", "/api/sales/current");
				});

				Then("the response status is {int}", (_ctx, status: number) => {
					expect(reply().status).toBe(status);
				});

				And("the body has error {string}", (_ctx, error: string) => {
					expect(reply().json.errorCode).toBe(error);
				});
			},
		);
	},
);
