// Binds specs/apps/flash/web/behaviours/proxy/api.feature at both the unit and the integration layer: the steps of each
// scenario, over the layer's world. Each scenario keeps the reply of its own last request, so no reply carries from one
// scenario to the next. The layer names the scenarios in its own test file, where the behaviour checker reads the titles.
import { expect } from "vitest";
import {
	isLoggedIn,
	type OutlineBinder,
	openSaleWithThree,
	openTenSale,
	SALE_10,
	SALE_WITH_3,
	type ScenarioBinder,
	visitorOpensPage,
} from "./web-steps";
import type { ApiAnswer, WebWorld } from "./web-world";

// The reply to the last request a scenario sent through the web server, kept where its steps read it.
type AnswerBox = { answer: ApiAnswer | undefined };

// The reply to the last request. A step that reads it before any request was sent fails.
function answerOf(box: AnswerBox): ApiAnswer {
	if (!box.answer) throw new Error("no request was sent");
	return box.answer;
}

// The attributes (`HttpOnly`, `Path=/`, ...) of the cookie of that name in the last reply.
function attributesOf(box: AnswerBox, name: string): string[] {
	const cookie = answerOf(box).cookies.find((value) =>
		value.startsWith(`${name}=`),
	);
	expect(cookie, `a cookie named ${name}`).toBeDefined();
	return (cookie ?? "").split(";").map((part) => part.trim());
}

// "the response status is {int}": the last reply has the status the scenario names.
function statusIs(box: AnswerBox) {
	return (_ctx: unknown, status: number) => {
		expect(answerOf(box).status).toBe(status);
	};
}

// "the body has error {string}": the body of the last reply carries the error code the scenario names.
function errorIs(box: AnswerBox) {
	return (_ctx: unknown, error: string) => {
		expect(answerOf(box).json.errorCode).toBe(error);
	};
}

// The browser reads the sale through the web server, and gets the sale the API holds.
function readsSaleThroughWeb(world: WebWorld): ScenarioBinder {
	return ({ Given, When, Then, And }) => {
		const last: AnswerBox = { answer: undefined };
		Given(SALE_WITH_3, openSaleWithThree(world));
		When("a client sends GET /api/sales/current", async () => {
			last.answer = await world.send("GET", "/api/sales/current");
		});
		Then("the response status is {int}", statusIs(last));
		And("the body names the sale", () => {
			expect(answerOf(last).json.id).toBe(world.saleId);
		});
	};
}

// The page the browser loads does not show the address of the API.
function pageHidesApi(world: WebWorld): ScenarioBinder {
	return ({ Given, When, Then }) => {
		Given(SALE_WITH_3, openSaleWithThree(world));
		When("a visitor opens the page", visitorOpensPage(world));
		Then("the page does not contain the address of the API", () => {
			expect(world.renderedPage()).not.toContain(world.apiAddress());
		});
	};
}

// A path outside the sale is refused by the web server, with the error the scenario names.
function pathsOutsideRefused(world: WebWorld): OutlineBinder {
	return ({ When, Then, And }, examples) => {
		const last: AnswerBox = { answer: undefined };
		When("a client sends GET <path>", async () => {
			last.answer = await world.send("GET", String(examples.path));
		});
		Then("the response status is {int}", statusIs(last));
		And("the body has error {string}", errorIs(last));
	};
}

// The operator routes are not reachable through the web server.
function operatorRoutesUnreachable(world: WebWorld): ScenarioBinder {
	return ({ When, Then }) => {
		const last: AnswerBox = { answer: undefined };
		When("a client sends GET /api/admin/sales", async () => {
			last.answer = await world.send("GET", "/api/admin/sales");
		});
		Then("the response status is {int}", statusIs(last));
	};
}

// A write request is passed on to the API with the cookie of the shopper who sent it.
function writePassedOn(world: WebWorld): ScenarioBinder {
	return ({ Given, And, When, Then }) => {
		const last: AnswerBox = { answer: undefined };
		Given(SALE_10, openTenSale(world));
		And("{string} is logged in", isLoggedIn(world));
		When("a client joins the queue through the web server", async () => {
			last.answer = await world.send(
				"POST",
				`/api/sales/${world.saleId}/queue`,
				{},
			);
		});
		Then("the response status is {int}", statusIs(last));
		And("the body has a ticket", () => {
			expect(typeof answerOf(last).json.ticket).toBe("string");
		});
		And("the body names {string}", (_ctx, name: string) => {
			expect(answerOf(last).json.userId).toBe(name);
		});
	};
}

// A request to join the queue without a login is refused by the API, and the web server passes the refusal on.
function anonymousRefused(world: WebWorld): ScenarioBinder {
	return ({ Given, When, Then, And }) => {
		const last: AnswerBox = { answer: undefined };
		Given(SALE_10, openTenSale(world));
		When("a client joins the queue through the web server", async () => {
			last.answer = await world.send(
				"POST",
				`/api/sales/${world.saleId}/queue`,
				{},
			);
		});
		Then("the response status is {int}", statusIs(last));
		And("the body has error {string}", errorIs(last));
	};
}

// Signing up sets both cookies, and the refresh cookie is only sent to the auth path.
function signUpSetsCookies(world: WebWorld): ScenarioBinder {
	return ({ When, Then, And }) => {
		const last: AnswerBox = { answer: undefined };
		When(
			"a client signs up through the web server as {string}",
			async (_ctx, name: string) => {
				last.answer = await world.send("POST", "/api/auth/register", {
					username: name,
					password: "a long password",
				});
			},
		);
		Then("the response status is {int}", statusIs(last));
		And(
			"the response sets the cookie {string} for the path {string}",
			(_ctx, name: string, path: string) => {
				expect(attributesOf(last, name)).toContain(`Path=${path}`);
			},
		);
		And(
			'the response sets the cookie "refresh_token" for the path "/api/auth"',
			() => {
				expect(attributesOf(last, "refresh_token")).toContain("Path=/api/auth");
			},
		);
		And("both cookies are HttpOnly", () => {
			const reply = answerOf(last);
			expect(reply.cookies).toHaveLength(2);
			for (const cookie of reply.cookies) {
				expect(cookie.split(";").map((part) => part.trim())).toContain(
					"HttpOnly",
				);
			}
		});
		And("the body holds neither token", () => {
			const reply = answerOf(last);
			const body = JSON.stringify(reply.json);
			for (const cookie of reply.cookies) {
				const token = cookie.split(";")[0]?.split("=")[1] ?? "";
				expect(token).not.toBe("");
				expect(body).not.toContain(token);
			}
		});
	};
}

// A request from another site is refused before it reaches the API.
function otherSiteRefused(world: WebWorld): ScenarioBinder {
	return ({ Given, And, When, Then }) => {
		const last: AnswerBox = { answer: undefined };
		Given(SALE_10, openTenSale(world));
		And("{string} is logged in", isLoggedIn(world));
		When("a client on another site sends POST /api/auth/logout", async () => {
			last.answer = await world.send(
				"POST",
				"/api/auth/logout",
				{},
				"http://evil.test",
			);
		});
		Then("the response status is {int}", statusIs(last));
		And("the body has error {string}", errorIs(last));
		And("the API was not asked", () => {
			expect(answerOf(last).reachedApi).toBe(false);
		});
	};
}

// The API cannot be reached, and the web server answers with a gateway error.
function apiUnreachable(world: WebWorld): ScenarioBinder {
	return ({ Given, When, Then, And }) => {
		const last: AnswerBox = { answer: undefined };
		Given("the sale cannot be reached", () => world.cutOff());
		When("a client sends GET /api/sales/current", async () => {
			last.answer = await world.send("GET", "/api/sales/current");
		});
		Then("the response status is {int}", statusIs(last));
		And("the body has error {string}", errorIs(last));
	};
}

// The steps of each scenario in the proxy feature, by the scenario's name in the layer's test file.
export function bindProxyApi(world: WebWorld) {
	return {
		readsSaleThroughWeb: readsSaleThroughWeb(world),
		pageHidesApi: pageHidesApi(world),
		pathsOutsideRefused: pathsOutsideRefused(world),
		operatorRoutesUnreachable: operatorRoutesUnreachable(world),
		writePassedOn: writePassedOn(world),
		anonymousRefused: anonymousRefused(world),
		signUpSetsCookies: signUpSetsCookies(world),
		otherSiteRefused: otherSiteRefused(world),
		apiUnreachable: apiUnreachable(world),
	};
}
