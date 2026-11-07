// Runs the proxy scenarios (`flash/web/behaviours/proxy/api.feature`) in the unit world.
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

// The attributes (`HttpOnly`, `Path=/`, ...) of the cookie of that name in the last reply.
function attributesOf(name: string): string[] {
	const cookie = reply().cookies.find((value) => value.startsWith(`${name}=`));
	expect(cookie, `a cookie named ${name}`).toBeDefined();
	return (cookie ?? "").split(";").map((part) => part.trim());
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
			"The operator routes are not reachable through the web server",
			({ When, Then }) => {
				When("a client sends GET /api/admin/sales", async () => {
					answer = await world.send("GET", "/api/admin/sales");
				});

				Then("the response status is {int}", (_ctx, status: number) => {
					expect(reply().status).toBe(status);
				});
			},
		);

		Scenario(
			"A write request is passed on with the cookie of the shopper",
			({ Given, And, When, Then }) => {
				Given(SALE_0, async () =>
					openSale(world, 10, 0, "1 hour ago", "in 1 hour"),
				);

				And("{string} is logged in", async (_ctx, name: string) =>
					world.loggedIn(name),
				);

				When("a client joins the queue through the web server", async () => {
					answer = await world.send(
						"POST",
						`/api/sales/${world.saleId}/queue`,
						{},
					);
				});

				Then("the response status is {int}", (_ctx, status: number) => {
					expect(reply().status).toBe(status);
				});

				And("the body has a ticket", () => {
					expect(typeof reply().json.ticket).toBe("string");
				});

				And("the body names {string}", (_ctx, name: string) => {
					expect(reply().json.userId).toBe(name);
				});
			},
		);

		Scenario(
			"A shopper who is not logged in is refused by the API",
			({ Given, When, Then, And }) => {
				Given(SALE_0, async () =>
					openSale(world, 10, 0, "1 hour ago", "in 1 hour"),
				);

				When("a client joins the queue through the web server", async () => {
					answer = await world.send(
						"POST",
						`/api/sales/${world.saleId}/queue`,
						{},
					);
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
			"Signing up sets both cookies, and the refresh cookie is moved under /api/auth",
			({ When, Then, And }) => {
				When(
					"a client signs up through the web server as {string}",
					async (_ctx, name: string) => {
						answer = await world.send("POST", "/api/auth/register", {
							username: name,
							password: "a long password",
						});
					},
				);

				Then("the response status is {int}", (_ctx, status: number) => {
					expect(reply().status).toBe(status);
				});

				And(
					"the response sets the cookie {string} for the path {string}",
					(_ctx, name: string, path: string) => {
						expect(attributesOf(name)).toContain(`Path=${path}`);
					},
				);

				And(
					'the response sets the cookie "refresh_token" for the path "/api/auth"',
					() => {
						expect(attributesOf("refresh_token")).toContain("Path=/api/auth");
					},
				);

				And("both cookies are HttpOnly", () => {
					expect(reply().cookies).toHaveLength(2);
					for (const cookie of reply().cookies) {
						expect(cookie.split(";").map((part) => part.trim())).toContain(
							"HttpOnly",
						);
					}
				});

				And("the body holds neither token", () => {
					const body = JSON.stringify(reply().json);
					for (const cookie of reply().cookies) {
						const token = cookie.split(";")[0]?.split("=")[1] ?? "";
						expect(token).not.toBe("");
						expect(body).not.toContain(token);
					}
				});
			},
		);

		Scenario(
			"A request from another site is refused before it reaches the API",
			({ Given, And, When, Then }) => {
				Given(SALE_0, async () =>
					openSale(world, 10, 0, "1 hour ago", "in 1 hour"),
				);

				And("{string} is logged in", async (_ctx, name: string) =>
					world.loggedIn(name),
				);

				When(
					"a client on another site sends POST /api/auth/logout",
					async () => {
						answer = await world.send(
							"POST",
							"/api/auth/logout",
							{},
							"http://evil.test",
						);
					},
				);

				Then("the response status is {int}", (_ctx, status: number) => {
					expect(reply().status).toBe(status);
				});

				And("the body has error {string}", (_ctx, error: string) => {
					expect(reply().json.errorCode).toBe(error);
				});

				And("the API was not asked", () => {
					expect(reply().reachedApi).toBe(false);
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
